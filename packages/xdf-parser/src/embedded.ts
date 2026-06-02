// Read/write helpers for XDF embedded-data descriptors.
//
// Type-flag bit layout (confirmed via Ghidra against TunerPro.exe's
// DEFAULTS serialiser, FUN_0048eeb0 around 0x0048fad5):
//
//   bit 0 (0x01) = signed
//   bit 1 (0x02) = lsbfirst   (little-endian)
//   bit 2 (0x04) = float
//
// When an EMBEDDEDDATA element omits `mmedtypeflags` (or sets it to 0),
// fall back to the file's <DEFAULTS>. Element sizes are in bits;
// addresses are byte-aligned.

import {
  resolveAddress,
  type XdfBaseOffset,
  type XdfDefaults,
  type XdfEmbeddedData,
} from "./index";

const FLAG_SIGNED = 0x01;
const FLAG_LSBFIRST = 0x02;
const FLAG_FLOAT = 0x04;

export interface EmbeddedSpec {
  /** signed integer (only meaningful when float=false) */
  signed: boolean;
  /** little-endian byte order for multi-byte reads */
  lsbfirst: boolean;
  /** IEEE-754 float (32 or 64 bits) */
  float: boolean;
  /** size in bits — typically 8/16/32, occasionally 64 */
  sizeBits: number;
  /** absolute byte index into the firmware buffer */
  address: number;
}

/**
 * Resolve an EMBEDDEDDATA + BASEOFFSET + DEFAULTS triple into the
 * effective read parameters. The function-level fallback rule: if
 * typeflags is zero or omitted, use DEFAULTS verbatim; otherwise the
 * typeflags bits win for the three flags they cover.
 */
export function resolveEmbedded(
  embed: XdfEmbeddedData,
  base: XdfBaseOffset,
  defaults: XdfDefaults,
): EmbeddedSpec {
  const flags = embed.typeflags;
  const useFlags = flags !== 0;
  return {
    signed: useFlags ? (flags & FLAG_SIGNED) !== 0 : defaults.signed,
    lsbfirst: useFlags ? (flags & FLAG_LSBFIRST) !== 0 : defaults.lsbfirst,
    float: useFlags ? (flags & FLAG_FLOAT) !== 0 : defaults.float,
    sizeBits: embed.elementsizebits > 0 ? embed.elementsizebits : defaults.datasizeinbits,
    address: resolveAddress(embed.address, base),
  };
}

/**
 * Read a scalar from `buffer` according to `spec`. Returns null when
 * the byte range falls outside the buffer (the structured editor uses
 * that to render a "—" rather than crash on a malformed .xdf).
 */
export function readScalar(buffer: Uint8Array, spec: EmbeddedSpec): number | null {
  const bytes = Math.max(1, Math.ceil(spec.sizeBits / 8));
  if (spec.address < 0 || spec.address + bytes > buffer.length) return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset + spec.address, bytes);
  const le = spec.lsbfirst;

  if (spec.float) {
    if (bytes === 4) return view.getFloat32(0, le);
    if (bytes === 8) return view.getFloat64(0, le);
    return null; // float8 / float16 not part of TunerPro semantics.
  }

  switch (bytes) {
    case 1:
      return spec.signed ? view.getInt8(0) : view.getUint8(0);
    case 2:
      return spec.signed ? view.getInt16(0, le) : view.getUint16(0, le);
    case 4:
      return spec.signed ? view.getInt32(0, le) : view.getUint32(0, le);
    case 8: {
      // 64-bit ints exceed Number's safe integer range but real .xdf
      // files don't seem to use them for scalars; coerce to Number and
      // accept lossy precision.
      const big = spec.signed ? view.getBigInt64(0, le) : view.getBigUint64(0, le);
      return Number(big);
    }
    default:
      return null;
  }
}

/**
 * Encode a scalar value into a fresh Uint8Array of the right size
 * for `spec`. Returns null if the value can't be represented (NaN
 * for ints, out-of-range integer, etc.).
 */
export function encodeScalar(value: number, spec: EmbeddedSpec): Uint8Array | null {
  const bytes = Math.max(1, Math.ceil(spec.sizeBits / 8));
  const buf = new ArrayBuffer(bytes);
  const view = new DataView(buf);
  const le = spec.lsbfirst;

  if (spec.float) {
    if (!Number.isFinite(value)) return null;
    if (bytes === 4) view.setFloat32(0, value, le);
    else if (bytes === 8) view.setFloat64(0, value, le);
    else return null;
    return new Uint8Array(buf);
  }

  if (!Number.isFinite(value)) return null;
  const intVal = Math.trunc(value);

  const ranges = {
    1: spec.signed ? { lo: -0x80, hi: 0x7f } : { lo: 0, hi: 0xff },
    2: spec.signed ? { lo: -0x8000, hi: 0x7fff } : { lo: 0, hi: 0xffff },
    4: spec.signed ? { lo: -0x80000000, hi: 0x7fffffff } : { lo: 0, hi: 0xffffffff },
  } as const;
  const r = ranges[bytes as 1 | 2 | 4];
  if (r && (intVal < r.lo || intVal > r.hi)) return null;

  switch (bytes) {
    case 1:
      if (spec.signed) view.setInt8(0, intVal);
      else view.setUint8(0, intVal);
      break;
    case 2:
      if (spec.signed) view.setInt16(0, intVal, le);
      else view.setUint16(0, intVal, le);
      break;
    case 4:
      if (spec.signed) view.setInt32(0, intVal, le);
      else view.setUint32(0, intVal, le);
      break;
    case 8: {
      // Round-trip through BigInt; same caveat as readScalar.
      const big = BigInt(intVal);
      if (spec.signed) view.setBigInt64(0, big, le);
      else view.setBigUint64(0, big, le);
      break;
    }
    default:
      return null;
  }
  return new Uint8Array(buf);
}

/** Read a single bit at `address & mask`. */
export function readFlag(
  buffer: Uint8Array,
  address: number,
  mask: number,
): boolean | null {
  if (address < 0 || address >= buffer.length) return null;
  return (buffer[address] & mask) !== 0;
}

/**
 * Toggle the bits in `mask` to `on` at `buffer[address]`. Returns the
 * new byte value (caller writes it back to the buffer).
 */
export function applyFlag(byte: number, mask: number, on: boolean): number {
  return on ? (byte | mask) & 0xff : (byte & ~mask) & 0xff;
}

/**
 * State of a patch entry relative to the current firmware buffer:
 * - "applied": bytes match patchdata
 * - "virgin":  bytes match basedata (only meaningful when basedata is non-empty)
 * - "neither": bytes match neither — partially applied or unknown
 */
export type PatchEntryState = "applied" | "virgin" | "neither";

/**
 * Compute the byte offset of cell (row, col) within a table-Z embed.
 *
 * TunerPro's stride convention (reverse-engineered from the MS43
 * user-information-field sub-tables):
 *
 *   - `mmedmajorstridebits` is the within-row step (between consecutive
 *     columns in the same row). When zero, the effective step is the
 *     element size.
 *   - `mmedminorstridebits` is the "tail stride" — the bits between the
 *     START of the last column in row r and the START of the first
 *     column in row r+1. When zero, the effective tail is the element
 *     size, giving the contiguous row-major layout.
 *
 * The full row pitch (bits from cell(r,0) to cell(r+1,0)) is therefore:
 *
 *     effective_minor + (cols - 1) * within_row_step
 *
 * For 1D tables (no `mmedcolcount`) the parser stores colcount=0; we
 * treat that as a single-column layout so the formula degenerates to a
 * vertical stride of `effective_minor`.
 *
 * Returns null only when the resulting bit address isn't byte-aligned
 * (sub-byte cells aren't part of TunerPro's normal use — flag bits
 * have their own kind).
 */
export function tableCellAddress(
  embed: XdfEmbeddedData,
  row: number,
  col: number,
): number | null {
  const ele = embed.elementsizebits;
  if (ele <= 0) return null;
  const cols = Math.max(1, embed.colcount);
  const withinRow = embed.majorstridebits !== 0 ? embed.majorstridebits : ele;
  const tail = embed.minorstridebits !== 0 ? embed.minorstridebits : ele;
  const rowPitchBits = tail + (cols - 1) * withinRow;
  const cellBits = row * rowPitchBits + col * withinRow;
  if (cellBits % 8 !== 0) return null;
  return embed.address + cellBits / 8;
}

export function patchEntryState(
  buffer: Uint8Array,
  address: number,
  patchdata: Uint8Array,
  basedata: Uint8Array,
): PatchEntryState {
  if (address < 0 || address + patchdata.length > buffer.length) return "neither";
  let matchesPatch = true;
  for (let i = 0; i < patchdata.length; i++) {
    if (buffer[address + i] !== patchdata[i]) {
      matchesPatch = false;
      break;
    }
  }
  if (matchesPatch) return "applied";
  if (basedata.length === patchdata.length) {
    let matchesBase = true;
    for (let i = 0; i < basedata.length; i++) {
      if (buffer[address + i] !== basedata[i]) {
        matchesBase = false;
        break;
      }
    }
    if (matchesBase) return "virgin";
  }
  return "neither";
}
