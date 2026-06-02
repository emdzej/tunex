// Numeric interpretations of bytes at a given offset. The hex editor
// uses these for both the side panel (read) and edit-as-type (write).

export type NumericType =
  | "u8"
  | "i8"
  | "u16le"
  | "u16be"
  | "i16le"
  | "i16be"
  | "u32le"
  | "u32be"
  | "i32le"
  | "i32be"
  | "f32le"
  | "f32be"
  | "f64le"
  | "f64be";

export const NUMERIC_TYPE_SIZES: Record<NumericType, number> = {
  u8: 1,
  i8: 1,
  u16le: 2,
  u16be: 2,
  i16le: 2,
  i16be: 2,
  u32le: 4,
  u32be: 4,
  i32le: 4,
  i32be: 4,
  f32le: 4,
  f32be: 4,
  f64le: 8,
  f64be: 8,
};

export const NUMERIC_TYPE_LABELS: Record<NumericType, string> = {
  u8: "uint8",
  i8: "int8",
  u16le: "uint16 LE",
  u16be: "uint16 BE",
  i16le: "int16 LE",
  i16be: "int16 BE",
  u32le: "uint32 LE",
  u32be: "uint32 BE",
  i32le: "int32 LE",
  i32be: "int32 BE",
  f32le: "float32 LE",
  f32be: "float32 BE",
  f64le: "float64 LE",
  f64be: "float64 BE",
};

// Subset shown in the edit-as-type popover (drop f64 — rare in ECU code).
export const EDITABLE_TYPES: NumericType[] = [
  "u8",
  "i8",
  "u16le",
  "u16be",
  "i16le",
  "i16be",
  "u32le",
  "u32be",
  "i32le",
  "i32be",
  "f32le",
  "f32be",
];

export function readNumeric(
  data: Uint8Array,
  offset: number,
  type: NumericType,
): number | null {
  const size = NUMERIC_TYPE_SIZES[type];
  if (offset < 0 || offset + size > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset, size);
  switch (type) {
    case "u8":
      return view.getUint8(0);
    case "i8":
      return view.getInt8(0);
    case "u16le":
      return view.getUint16(0, true);
    case "u16be":
      return view.getUint16(0, false);
    case "i16le":
      return view.getInt16(0, true);
    case "i16be":
      return view.getInt16(0, false);
    case "u32le":
      return view.getUint32(0, true);
    case "u32be":
      return view.getUint32(0, false);
    case "i32le":
      return view.getInt32(0, true);
    case "i32be":
      return view.getInt32(0, false);
    case "f32le":
      return view.getFloat32(0, true);
    case "f32be":
      return view.getFloat32(0, false);
    case "f64le":
      return view.getFloat64(0, true);
    case "f64be":
      return view.getFloat64(0, false);
  }
}

/**
 * Encode `value` as `type` into a fresh Uint8Array. Returns null if the
 * value overflows the target type's range (caller surfaces an error).
 */
export function encodeNumeric(value: number, type: NumericType): Uint8Array | null {
  const size = NUMERIC_TYPE_SIZES[type];
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  if (!inRange(value, type)) return null;
  switch (type) {
    case "u8":
      view.setUint8(0, value);
      break;
    case "i8":
      view.setInt8(0, value);
      break;
    case "u16le":
      view.setUint16(0, value, true);
      break;
    case "u16be":
      view.setUint16(0, value, false);
      break;
    case "i16le":
      view.setInt16(0, value, true);
      break;
    case "i16be":
      view.setInt16(0, value, false);
      break;
    case "u32le":
      view.setUint32(0, value, true);
      break;
    case "u32be":
      view.setUint32(0, value, false);
      break;
    case "i32le":
      view.setInt32(0, value, true);
      break;
    case "i32be":
      view.setInt32(0, value, false);
      break;
    case "f32le":
      view.setFloat32(0, value, true);
      break;
    case "f32be":
      view.setFloat32(0, value, false);
      break;
    case "f64le":
      view.setFloat64(0, value, true);
      break;
    case "f64be":
      view.setFloat64(0, value, false);
      break;
  }
  return new Uint8Array(buf);
}

function inRange(value: number, type: NumericType): boolean {
  if (Number.isNaN(value)) return false;
  switch (type) {
    case "u8":
      return Number.isInteger(value) && value >= 0 && value <= 0xff;
    case "i8":
      return Number.isInteger(value) && value >= -0x80 && value <= 0x7f;
    case "u16le":
    case "u16be":
      return Number.isInteger(value) && value >= 0 && value <= 0xffff;
    case "i16le":
    case "i16be":
      return Number.isInteger(value) && value >= -0x8000 && value <= 0x7fff;
    case "u32le":
    case "u32be":
      return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
    case "i32le":
    case "i32be":
      return Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff;
    case "f32le":
    case "f32be":
    case "f64le":
    case "f64be":
      return Number.isFinite(value);
  }
}

/** ASCII printable check: 0x20–0x7e. */
export function isPrintable(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

export function asciiChar(byte: number): string {
  return isPrintable(byte) ? String.fromCharCode(byte) : ".";
}

/**
 * Read a UTF-8 codepoint starting at `offset`. Returns null if the
 * bytes don't form a valid codepoint (or buffer is too short). The
 * interpretation panel only cares about the first character — a single
 * codepoint is sufficient.
 */
export function readUtf8Char(data: Uint8Array, offset: number): string | null {
  if (offset >= data.length) return null;
  const b0 = data[offset];
  if (b0 < 0x80) return String.fromCharCode(b0);
  let codepoint = 0;
  let extra = 0;
  if ((b0 & 0xe0) === 0xc0) {
    codepoint = b0 & 0x1f;
    extra = 1;
  } else if ((b0 & 0xf0) === 0xe0) {
    codepoint = b0 & 0x0f;
    extra = 2;
  } else if ((b0 & 0xf8) === 0xf0) {
    codepoint = b0 & 0x07;
    extra = 3;
  } else {
    return null;
  }
  if (offset + extra >= data.length) return null;
  for (let i = 1; i <= extra; i++) {
    const b = data[offset + i];
    if ((b & 0xc0) !== 0x80) return null;
    codepoint = (codepoint << 6) | (b & 0x3f);
  }
  try {
    return String.fromCodePoint(codepoint);
  } catch {
    return null;
  }
}
