import { describe, it, expect } from "vitest";
import {
  resolveEmbedded,
  readScalar,
  encodeScalar,
  readFlag,
  applyFlag,
  patchEntryState,
  tableCellAddress,
} from "./embedded";
import type { XdfBaseOffset, XdfDefaults, XdfEmbeddedData } from "./index";
// XdfEmbeddedData literals below leave out the optional fields — the
// embed() helper already provides defaults; here we construct directly
// for the stride tests.
void {} as XdfEmbeddedData;

const NO_OFFSET: XdfBaseOffset = { offset: 0, subtract: false };
const DEFAULTS: XdfDefaults = {
  datasizeinbits: 8,
  sigdigits: 2,
  outputtype: 1,
  signed: false,
  lsbfirst: true,
  float: false,
};

function embed(part: Partial<XdfEmbeddedData> = {}): XdfEmbeddedData {
  return {
    typeflags: 0x02,
    address: 0,
    elementsizebits: 8,
    majorstridebits: 0,
    minorstridebits: 0,
    ...part,
  };
}

describe("resolveEmbedded", () => {
  it("decodes 0x02 as little-endian unsigned non-float", () => {
    const spec = resolveEmbedded(embed({ typeflags: 0x02 }), NO_OFFSET, DEFAULTS);
    expect(spec).toMatchObject({ signed: false, lsbfirst: true, float: false });
  });

  it("decodes 0x03 as signed little-endian", () => {
    const spec = resolveEmbedded(embed({ typeflags: 0x03 }), NO_OFFSET, DEFAULTS);
    expect(spec.signed).toBe(true);
    expect(spec.lsbfirst).toBe(true);
  });

  it("decodes 0x04 as float", () => {
    const spec = resolveEmbedded(embed({ typeflags: 0x04 }), NO_OFFSET, DEFAULTS);
    expect(spec.float).toBe(true);
  });

  it("falls back to DEFAULTS when typeflags is 0", () => {
    const spec = resolveEmbedded(
      embed({ typeflags: 0 }),
      NO_OFFSET,
      { ...DEFAULTS, signed: true, lsbfirst: false, float: false },
    );
    expect(spec).toMatchObject({ signed: true, lsbfirst: false, float: false });
  });

  it("applies BASEOFFSET to the resolved address", () => {
    const spec = resolveEmbedded(
      embed({ address: 0x100 }),
      { offset: 0x40, subtract: false },
      DEFAULTS,
    );
    expect(spec.address).toBe(0x140);
  });
});

describe("readScalar", () => {
  const buf = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe]);

  it("reads u8", () => {
    const spec = resolveEmbedded(
      embed({ typeflags: 0x02, address: 0, elementsizebits: 8 }),
      NO_OFFSET,
      DEFAULTS,
    );
    expect(readScalar(buf, spec)).toBe(0x01);
  });

  it("reads u16 LE", () => {
    const spec = resolveEmbedded(
      embed({ typeflags: 0x02, address: 0, elementsizebits: 16 }),
      NO_OFFSET,
      DEFAULTS,
    );
    expect(readScalar(buf, spec)).toBe(0x0201);
  });

  it("reads i16 LE (sign-extends)", () => {
    const spec = resolveEmbedded(
      embed({ typeflags: 0x03, address: 4, elementsizebits: 16 }),
      NO_OFFSET,
      DEFAULTS,
    );
    // 0xfeff as int16 = -257 (twos-complement: 0xfeff - 0x10000)
    expect(readScalar(buf, spec)).toBe(-257);
  });

  it("reads u32 BE", () => {
    const spec = resolveEmbedded(
      embed({ typeflags: 0x00, address: 0, elementsizebits: 32 }),
      NO_OFFSET,
      { ...DEFAULTS, lsbfirst: false },
    );
    expect(readScalar(buf, spec)).toBe(0x01020304);
  });

  it("returns null when out of range", () => {
    const spec = resolveEmbedded(
      embed({ typeflags: 0x02, address: 100, elementsizebits: 8 }),
      NO_OFFSET,
      DEFAULTS,
    );
    expect(readScalar(buf, spec)).toBeNull();
  });
});

describe("encodeScalar", () => {
  it("encodes u8", () => {
    const spec = resolveEmbedded(embed({ elementsizebits: 8 }), NO_OFFSET, DEFAULTS);
    expect(encodeScalar(42, spec)).toEqual(new Uint8Array([42]));
  });

  it("encodes u16 LE", () => {
    const spec = resolveEmbedded(embed({ elementsizebits: 16 }), NO_OFFSET, DEFAULTS);
    expect(encodeScalar(0xbeef, spec)).toEqual(new Uint8Array([0xef, 0xbe]));
  });

  it("rejects values out of unsigned range", () => {
    const spec = resolveEmbedded(embed({ elementsizebits: 8 }), NO_OFFSET, DEFAULTS);
    expect(encodeScalar(-1, spec)).toBeNull();
    expect(encodeScalar(256, spec)).toBeNull();
  });

  it("round-trips float32", () => {
    const spec = resolveEmbedded(
      embed({ typeflags: 0x04 | 0x02, elementsizebits: 32 }),
      NO_OFFSET,
      DEFAULTS,
    );
    const bytes = encodeScalar(3.14, spec)!;
    expect(readScalar(bytes, { ...spec, address: 0 })).toBeCloseTo(3.14, 5);
  });
});

describe("readFlag / applyFlag", () => {
  it("reads a bit", () => {
    const buf = new Uint8Array([0b0000_0100]);
    expect(readFlag(buf, 0, 0x04)).toBe(true);
    expect(readFlag(buf, 0, 0x08)).toBe(false);
  });
  it("toggles bits", () => {
    expect(applyFlag(0b0000_0000, 0x04, true)).toBe(0b0000_0100);
    expect(applyFlag(0b0000_0100, 0x04, false)).toBe(0b0000_0000);
    expect(applyFlag(0b0000_0100, 0x04, true)).toBe(0b0000_0100); // idempotent
  });
});

describe("tableCellAddress — MS43 user-information-field layouts", () => {
  // Parent UIF table: 14 rows × 46 columns at 0x3C40, contiguous bytes.
  it("contiguous 14×46 — cell(r,c) = base + r*46 + c", () => {
    const e: XdfEmbeddedData = {
      typeflags: 0x02,
      address: 0x3c40,
      elementsizebits: 8,
      rowcount: 14,
      colcount: 46,
      majorstridebits: 0,
      minorstridebits: 0,
    };
    expect(tableCellAddress(e, 0, 0)).toBe(0x3c40);
    expect(tableCellAddress(e, 0, 45)).toBe(0x3c40 + 45);
    expect(tableCellAddress(e, 1, 0)).toBe(0x3c40 + 46);
    expect(tableCellAddress(e, 13, 45)).toBe(0x3c40 + 13 * 46 + 45);
  });

  // VIN sub-table: 14 rows × 13 columns at 0x3C40, minorstride=272 bits
  // (parent row pitch of 46 bytes).
  it("VIN sub-view 14×13 with minorstride=272", () => {
    const e: XdfEmbeddedData = {
      typeflags: 0x02,
      address: 0x3c40,
      elementsizebits: 8,
      rowcount: 14,
      colcount: 13,
      majorstridebits: 0,
      minorstridebits: 272,
    };
    expect(tableCellAddress(e, 0, 0)).toBe(0x3c40);
    expect(tableCellAddress(e, 0, 12)).toBe(0x3c40 + 12);
    expect(tableCellAddress(e, 1, 0)).toBe(0x3c40 + 46);
    expect(tableCellAddress(e, 13, 12)).toBe(0x3c40 + 13 * 46 + 12);
  });

  // 14×2 sub-view starting at column 14 of the parent (0x3C4E),
  // minorstride=360 — still encodes the same 46-byte parent pitch.
  it("DATE sub-view 14×2 with minorstride=360", () => {
    const e: XdfEmbeddedData = {
      typeflags: 0x02,
      address: 0x3c4e,
      elementsizebits: 8,
      rowcount: 14,
      colcount: 2,
      majorstridebits: 0,
      minorstridebits: 360,
    };
    expect(tableCellAddress(e, 0, 0)).toBe(0x3c4e);
    expect(tableCellAddress(e, 0, 1)).toBe(0x3c4e + 1);
    expect(tableCellAddress(e, 1, 0)).toBe(0x3c4e + 46);
    expect(tableCellAddress(e, 13, 1)).toBe(0x3c4e + 13 * 46 + 1);
  });

  // 1D 14×(no colcount) of uint32 at 0x3C50 with minorstride=368 (= 46 bytes).
  it("1D 14-element u32 column at parent column 16", () => {
    const e: XdfEmbeddedData = {
      typeflags: 0x02,
      address: 0x3c50,
      elementsizebits: 32,
      rowcount: 14,
      colcount: 0,
      majorstridebits: 0,
      minorstridebits: 368,
    };
    expect(tableCellAddress(e, 0, 0)).toBe(0x3c50);
    expect(tableCellAddress(e, 1, 0)).toBe(0x3c50 + 46);
    expect(tableCellAddress(e, 13, 0)).toBe(0x3c50 + 13 * 46);
  });

  it("returns null for sub-byte misalignment", () => {
    const e: XdfEmbeddedData = {
      typeflags: 0x02,
      address: 0,
      elementsizebits: 4, // 4-bit cells produce mid-byte addresses on col 1
      rowcount: 1,
      colcount: 2,
      majorstridebits: 0,
      minorstridebits: 0,
    };
    expect(tableCellAddress(e, 0, 0)).toBe(0);
    expect(tableCellAddress(e, 0, 1)).toBeNull();
  });
});

describe("patchEntryState", () => {
  const patch = new Uint8Array([0xde, 0xad]);
  const base = new Uint8Array([0x00, 0x00]);

  it("detects applied", () => {
    const buf = new Uint8Array([0xde, 0xad, 0xff]);
    expect(patchEntryState(buf, 0, patch, base)).toBe("applied");
  });

  it("detects virgin", () => {
    const buf = new Uint8Array([0x00, 0x00, 0xff]);
    expect(patchEntryState(buf, 0, patch, base)).toBe("virgin");
  });

  it("detects neither", () => {
    const buf = new Uint8Array([0x12, 0x34, 0xff]);
    expect(patchEntryState(buf, 0, patch, base)).toBe("neither");
  });

  it("returns neither when basedata is empty (destructive patch)", () => {
    const buf = new Uint8Array([0xff, 0xff, 0xff]);
    expect(patchEntryState(buf, 0, patch, new Uint8Array())).toBe("neither");
    // ...except when applied — that we can still detect.
    expect(patchEntryState(new Uint8Array([0xde, 0xad]), 0, patch, new Uint8Array())).toBe("applied");
  });
});
