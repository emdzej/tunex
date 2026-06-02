// @tunex/xdf-parser — TunerPro .xdf definition file parser.
//
// v0 covers what the MS42/MS43 community patchlists need: CONSTANT, FLAG,
// PATCH, and 1D/2D TABLE. The type union is intentionally open so 3D
// tables and the obscure datatype/unittype enums can slot in later once
// TunerPro.exe's parser is reverse-engineered (see project memory).

// @xmldom/xmldom is a pure-JS XML DOM with consistent text/xml parsing
// across Node + browser. The browser's native DOMParser handles XML
// fine, but uniform behaviour in tests + production beats sometimes
// loading a separate parser. Bundle cost is ~30 KB gzipped — paid once
// when the structured editor first touches a .xdf, since this package
// is dynamically imported there.
import { DOMParser as XmlDomParser, type Element as XmlElement } from "@xmldom/xmldom";

export { parseMath, evalMath, compileMath, linearize, invertLinear, MathParseError } from "./math";
export type { Expr } from "./math";

export {
  resolveEmbedded,
  readScalar,
  encodeScalar,
  readFlag,
  applyFlag,
  patchEntryState,
  tableCellAddress,
} from "./embedded";
export type { EmbeddedSpec, PatchEntryState } from "./embedded";

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
  /** Number of rows for table z-data; 0 / 1 for scalars. */
  rowcount: number;
  /** Number of columns for table z-data; 0 / 1 for scalars + 1D rows. */
  colcount: number;
  /** Bits between consecutive minor-axis steps (between rows for 2D). */
  majorstridebits: number;
  /** Bits between consecutive major-axis steps (between cells in a row). */
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
  /**
   * Bytes before applying the patch (stock / virgin). May be empty for
   * destructive patches that don't claim a known stock value (e.g. the
   * MS43 "Clear ISN Data" entry wipes a region with no defined prior
   * state). When empty, revert-to-virgin isn't possible.
   */
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
  /**
   * Number of decimal places for the axis's displayed values. TunerPro
   * formats with `%.*lf`, defaulting to 2 when absent (XDFAXIS only
   * emits the tag when ≠ 2 — confirmed via Ghidra serialiser).
   */
  decimalpl?: number;
  units?: string;
  min?: number;
  max?: number;
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

export class XdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XdfParseError";
  }
}

/** Parse a hex or decimal numeric attribute (TunerPro uses both freely). */
function parseNumber(raw: string | null | undefined, fallback?: number): number {
  if (raw === null || raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new XdfParseError("missing numeric value");
  }
  const trimmed = raw.trim();
  const isHex = /^-?0x/i.test(trimmed);
  const n = isHex
    ? parseInt(trimmed.replace(/^-?0x/i, ""), 16) * (trimmed.startsWith("-") ? -1 : 1)
    : Number(trimmed);
  if (!Number.isFinite(n)) {
    if (fallback !== undefined) return fallback;
    throw new XdfParseError(`could not parse number "${raw}"`);
  }
  return n;
}

function parseBool(raw: string | null | undefined, fallback: boolean): boolean {
  if (raw === null || raw === undefined) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n)) return n !== 0;
  const lc = raw.trim().toLowerCase();
  if (lc === "true") return true;
  if (lc === "false") return false;
  return fallback;
}

/** Decode a hex-encoded byte string like "DA0DF83B" into a Uint8Array. */
export function decodeHexBytes(raw: string): Uint8Array {
  const cleaned = raw.replace(/\s+/g, "");
  if (cleaned.length % 2 !== 0) {
    throw new XdfParseError(`hex byte string has odd length: "${raw}"`);
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new XdfParseError(`invalid hex byte at position ${i * 2}: "${raw}"`);
    }
    out[i] = byte;
  }
  return out;
}

function getText(parent: XmlElement, tag: string, fallback = ""): string {
  const el = parent.getElementsByTagName(tag).item(0);
  if (!el) return fallback;
  return el.textContent ?? fallback;
}

function getAttr(el: XmlElement, name: string): string | null {
  return el.getAttribute(name);
}

function parseEmbeddedData(el: XmlElement, defaults: XdfDefaults): XdfEmbeddedData {
  return {
    typeflags: parseNumber(getAttr(el, "mmedtypeflags"), 0),
    address: parseNumber(getAttr(el, "mmedaddress"), 0),
    elementsizebits: parseNumber(
      getAttr(el, "mmedelementsizebits"),
      defaults.datasizeinbits,
    ),
    rowcount: parseNumber(getAttr(el, "mmedrowcount"), 0),
    colcount: parseNumber(getAttr(el, "mmedcolcount"), 0),
    majorstridebits: parseNumber(getAttr(el, "mmedmajorstridebits"), 0),
    minorstridebits: parseNumber(getAttr(el, "mmedminorstridebits"), 0),
  };
}

function parseCategoryMems(el: XmlElement): number[] {
  const out: number[] = [];
  const list = el.getElementsByTagName("CATEGORYMEM");
  for (let i = 0; i < list.length; i++) {
    const cm = list.item(i);
    if (!cm) continue;
    // CATEGORYMEM siblings can belong to nested children (e.g. axis
    // children inside a table). Skip ones not directly under `el`.
    if (cm.parentElement !== el) continue;
    out.push(parseNumber(getAttr(cm, "category"), 0));
  }
  return out;
}

function parseMathEquation(parent: XmlElement): string {
  const math = parent.getElementsByTagName("MATH").item(0);
  if (!math) return "X";
  const eq = math.getAttribute("equation");
  return eq && eq.trim() !== "" ? eq : "X";
}

function parseHeader(el: XmlElement): XdfHeader {
  const baseEl = el.getElementsByTagName("BASEOFFSET").item(0);
  const baseOffset: XdfBaseOffset = baseEl
    ? {
        offset: parseNumber(getAttr(baseEl, "offset"), 0),
        subtract: parseBool(getAttr(baseEl, "subtract"), false),
      }
    : { offset: 0, subtract: false };

  const defEl = el.getElementsByTagName("DEFAULTS").item(0);
  const defaults: XdfDefaults = {
    datasizeinbits: parseNumber(defEl && getAttr(defEl, "datasizeinbits"), 8),
    sigdigits: parseNumber(defEl && getAttr(defEl, "sigdigits"), 2),
    outputtype: parseNumber(defEl && getAttr(defEl, "outputtype"), 1),
    signed: parseBool(defEl && getAttr(defEl, "signed"), false),
    lsbfirst: parseBool(defEl && getAttr(defEl, "lsbfirst"), true),
    float: parseBool(defEl && getAttr(defEl, "float"), false),
  };

  const regions: XdfRegion[] = [];
  const regionList = el.getElementsByTagName("REGION");
  for (let i = 0; i < regionList.length; i++) {
    const r = regionList.item(i);
    if (!r) continue;
    regions.push({
      type: parseNumber(getAttr(r, "type"), 0),
      startaddress: parseNumber(getAttr(r, "startaddress"), 0),
      size: parseNumber(getAttr(r, "size"), 0),
      name: getAttr(r, "name") ?? "",
      description: getAttr(r, "desc") ?? undefined,
    });
  }

  const categories: XdfCategory[] = [];
  const catList = el.getElementsByTagName("CATEGORY");
  for (let i = 0; i < catList.length; i++) {
    const c = catList.item(i);
    if (!c) continue;
    categories.push({
      index: parseNumber(getAttr(c, "index"), 0),
      name: getAttr(c, "name") ?? "",
    });
  }

  return {
    flags: parseNumber(getText(el, "flags", "0"), 0),
    fileversion: getText(el, "fileversion"),
    deftitle: getText(el, "deftitle"),
    description: getText(el, "description"),
    author: getText(el, "author"),
    baseOffset,
    defaults,
    regions,
    categories,
  };
}

function parseCommon(el: XmlElement): XdfItemCommon {
  return {
    uniqueid: parseNumber(getAttr(el, "uniqueid"), 0),
    title: getText(el, "title"),
    description: getText(el, "description"),
    categoryIndices: parseCategoryMems(el),
  };
}

function parseConstant(el: XmlElement, defaults: XdfDefaults): XdfConstant {
  const embedEl = el.getElementsByTagName("EMBEDDEDDATA").item(0);
  if (!embedEl) throw new XdfParseError("XDFCONSTANT missing EMBEDDEDDATA");
  const decText = getText(el, "decimalpl", "");
  const rangeLow = getText(el, "rangelow", "");
  const rangeHigh = getText(el, "rangehigh", "");
  const datatypeText = getText(el, "datatype", "");
  const unittypeText = getText(el, "unittype", "");
  const unitsText = getText(el, "units", "");
  return {
    ...parseCommon(el),
    kind: "constant",
    embed: parseEmbeddedData(embedEl, defaults),
    units: unitsText || undefined,
    decimalpl: decText !== "" ? parseNumber(decText, 0) : undefined,
    rangelow: rangeLow !== "" ? parseNumber(rangeLow, 0) : undefined,
    rangehigh: rangeHigh !== "" ? parseNumber(rangeHigh, 0) : undefined,
    datatype: datatypeText !== "" ? parseNumber(datatypeText, 0) : undefined,
    unittype: unittypeText !== "" ? parseNumber(unittypeText, 0) : undefined,
    mathEquation: parseMathEquation(el),
  };
}

function parseFlag(el: XmlElement, defaults: XdfDefaults): XdfFlag {
  const embedEl = el.getElementsByTagName("EMBEDDEDDATA").item(0);
  if (!embedEl) throw new XdfParseError("XDFFLAG missing EMBEDDEDDATA");
  return {
    ...parseCommon(el),
    kind: "flag",
    embed: parseEmbeddedData(embedEl, defaults),
    mask: parseNumber(getText(el, "mask"), 0),
  };
}

function parsePatch(el: XmlElement): XdfPatch {
  const entries: XdfPatchEntry[] = [];
  const list = el.getElementsByTagName("XDFPATCHENTRY");
  for (let i = 0; i < list.length; i++) {
    const e = list.item(i);
    if (!e) continue;
    entries.push({
      name: getAttr(e, "name") ?? "",
      address: parseNumber(getAttr(e, "address"), 0),
      datasize: parseNumber(getAttr(e, "datasize"), 0),
      patchdata: decodeHexBytes(getAttr(e, "patchdata") ?? ""),
      basedata: decodeHexBytes(getAttr(e, "basedata") ?? ""),
    });
  }
  return { ...parseCommon(el), kind: "patch", entries };
}

function parseAxis(el: XmlElement, defaults: XdfDefaults): XdfAxis {
  const embedEl = el.getElementsByTagName("EMBEDDEDDATA").item(0);
  if (!embedEl) {
    throw new XdfParseError(`XDFAXIS id="${getAttr(el, "id")}" missing EMBEDDEDDATA`);
  }
  const id = (getAttr(el, "id") ?? "x").toLowerCase();
  if (id !== "x" && id !== "y" && id !== "z") {
    throw new XdfParseError(`XDFAXIS has unexpected id "${id}"`);
  }
  const labels: XdfAxisLabel[] = [];
  const labelList = el.getElementsByTagName("LABEL");
  for (let i = 0; i < labelList.length; i++) {
    const l = labelList.item(i);
    if (!l) continue;
    if (l.parentElement !== el) continue;
    labels.push({
      index: parseNumber(getAttr(l, "index"), 0),
      value: getAttr(l, "value") ?? "",
    });
  }
  const outputtypeText = getText(el, "outputtype", "");
  const datatypeText = getText(el, "datatype", "");
  const unittypeText = getText(el, "unittype", "");
  const decText = getText(el, "decimalpl", "");
  const minText = getText(el, "min", "");
  const maxText = getText(el, "max", "");
  const unitsText = getText(el, "units", "");
  return {
    id,
    uniqueid: parseNumber(getAttr(el, "uniqueid"), 0),
    embed: parseEmbeddedData(embedEl, defaults),
    indexcount: parseNumber(getText(el, "indexcount", "0"), 0),
    outputtype: outputtypeText !== "" ? parseNumber(outputtypeText, 0) : undefined,
    datatype: datatypeText !== "" ? parseNumber(datatypeText, 0) : undefined,
    unittype: unittypeText !== "" ? parseNumber(unittypeText, 0) : undefined,
    decimalpl: decText !== "" ? parseNumber(decText, 0) : undefined,
    units: unitsText || undefined,
    min: minText !== "" ? parseNumber(minText, 0) : undefined,
    max: maxText !== "" ? parseNumber(maxText, 0) : undefined,
    labels,
    mathEquation: parseMathEquation(el),
  };
}

function parseTable(el: XmlElement, defaults: XdfDefaults): XdfTable {
  const axes: XdfAxis[] = [];
  const list = el.getElementsByTagName("XDFAXIS");
  for (let i = 0; i < list.length; i++) {
    const a = list.item(i);
    if (!a) continue;
    if (a.parentElement !== el) continue;
    axes.push(parseAxis(a, defaults));
  }
  return { ...parseCommon(el), kind: "table", axes };
}

/** Parse a TunerPro .xdf XML string into a typed definition. */
export function parseXdf(xml: string): XdfDefinition {
  const doc = new XmlDomParser().parseFromString(xml, "text/xml");

  // DOMParser surfaces parse errors as a `<parsererror>` node rather
  // than throwing — handle both forms across environments.
  const parserError = doc.getElementsByTagName("parsererror").item(0);
  if (parserError && parserError.textContent) {
    throw new XdfParseError(`XML parse error: ${parserError.textContent.trim()}`);
  }

  const root = doc.documentElement;
  if (!root || root.tagName !== "XDFFORMAT") {
    throw new XdfParseError(
      `expected <XDFFORMAT> root, got <${root?.tagName ?? "nothing"}>`,
    );
  }

  const headerEl = root.getElementsByTagName("XDFHEADER").item(0);
  if (!headerEl) throw new XdfParseError("missing <XDFHEADER>");
  const header = parseHeader(headerEl);

  const items: XdfItem[] = [];
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children.item(i);
    if (!child) continue;
    switch (child.tagName) {
      case "XDFHEADER":
        // Already consumed.
        break;
      case "XDFCONSTANT":
        items.push(parseConstant(child, header.defaults));
        break;
      case "XDFFLAG":
        items.push(parseFlag(child, header.defaults));
        break;
      case "XDFPATCH":
        items.push(parsePatch(child));
        break;
      case "XDFTABLE":
        items.push(parseTable(child, header.defaults));
        break;
      default:
        // Unknown XDF children are tolerated for forward-compat.
        break;
    }
  }

  return { header, items };
}

/**
 * Resolve a raw `mmedaddress` against a base offset to a byte index
 * into the firmware. TunerPro's BASEOFFSET can either add or subtract.
 */
export function resolveAddress(raw: number, base: XdfBaseOffset): number {
  return base.subtract ? raw - base.offset : raw + base.offset;
}
