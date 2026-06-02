// @tunex/xdf-parser — TunerPro .xdf definition file parser.
//
// v0 covers what the MS42/MS43 community patchlists need: CONSTANT, FLAG,
// PATCH, and 1D/2D TABLE. The type union is intentionally open so 3D
// tables and the obscure datatype/unittype enums can slot in later once
// TunerPro.exe's parser is reverse-engineered (see project memory).

export type XdfItemKind = "constant" | "flag" | "patch" | "table";

export interface XdfCategory {
  index: number;
  name: string;
}

export interface XdfBaseOffset {
  offset: number;
  subtract: boolean;
}

export interface XdfDefaults {
  datasizeinbits: number;
  sigdigits: number;
  outputtype: number;
  signed: boolean;
  lsbfirst: boolean;
  float: boolean;
}

export interface XdfRegion {
  type: number;
  startaddress: number;
  size: number;
  name: string;
  description?: string;
}

export interface XdfHeader {
  flags: number;
  fileversion: string;
  deftitle: string;
  description: string;
  author: string;
  baseOffset: XdfBaseOffset;
  defaults: XdfDefaults;
  regions: XdfRegion[];
  categories: XdfCategory[];
}

export interface XdfItemCommon {
  uniqueid: number;
  title: string;
  description: string;
  /** Category indices the item belongs to. Most items have one. */
  categoryIndices: number[];
}

export interface XdfEmbeddedData {
  /** Raw bit-flags (`mmedtypeflags`). 0x02 is the most common scalar form. */
  typeflags: number;
  /** Effective address before BASEOFFSET is applied. */
  address: number;
  /** Element size in bits. */
  elementsizebits: number;
  majorstridebits: number;
  minorstridebits: number;
}

export interface XdfConstant extends XdfItemCommon {
  kind: "constant";
  embed: XdfEmbeddedData;
  units?: string;
  decimalpl?: number;
  rangelow?: number;
  rangehigh?: number;
  datatype?: number;
  unittype?: number;
  /** Raw MATH equation string, e.g. "0.75*X-48.0". */
  mathEquation: string;
}

export interface XdfFlag extends XdfItemCommon {
  kind: "flag";
  embed: XdfEmbeddedData;
  /** Bit mask within the byte at `embed.address`. */
  mask: number;
}

export interface XdfPatchEntry {
  name: string;
  address: number;
  datasize: number;
  /** Bytes after applying the patch. */
  patchdata: Uint8Array;
  /** Bytes before applying the patch (stock / virgin). */
  basedata: Uint8Array;
}

export interface XdfPatch extends XdfItemCommon {
  kind: "patch";
  entries: XdfPatchEntry[];
}

export interface XdfAxisLabel {
  index: number;
  value: string;
}

export interface XdfAxis {
  id: "x" | "y" | "z";
  uniqueid: number;
  embed: XdfEmbeddedData;
  indexcount: number;
  outputtype?: number;
  datatype?: number;
  unittype?: number;
  /** When present, axis is rendered as discrete labels instead of values. */
  labels: XdfAxisLabel[];
  mathEquation: string;
}

export interface XdfTable extends XdfItemCommon {
  kind: "table";
  axes: XdfAxis[];
}

export type XdfItem = XdfConstant | XdfFlag | XdfPatch | XdfTable;

export interface XdfDefinition {
  header: XdfHeader;
  items: XdfItem[];
}

/**
 * Parse a TunerPro .xdf XML string. v0 returns a stub — actual
 * implementation lands in Milestone 2.
 */
export function parseXdf(_xml: string): XdfDefinition {
  throw new Error("parseXdf not yet implemented (Milestone 2)");
}

/**
 * Resolve a raw `mmedaddress` against a base offset to a byte index
 * into the firmware. TunerPro's BASEOFFSET can either add or subtract.
 */
export function resolveAddress(raw: number, base: XdfBaseOffset): number {
  return base.subtract ? raw - base.offset : raw + base.offset;
}
