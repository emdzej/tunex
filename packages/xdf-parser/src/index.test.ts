import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  decodeHexBytes,
  parseXdf,
  resolveAddress,
  XdfParseError,
  type XdfConstant,
  type XdfFlag,
  type XdfPatch,
} from "./index";

describe("resolveAddress", () => {
  it("adds when subtract=false", () => {
    expect(resolveAddress(0x100, { offset: 0x40, subtract: false })).toBe(0x140);
  });
  it("subtracts when subtract=true", () => {
    expect(resolveAddress(0x100, { offset: 0x40, subtract: true })).toBe(0xc0);
  });
});

describe("decodeHexBytes", () => {
  it("decodes a canonical patch payload", () => {
    expect(decodeHexBytes("DA0DF83B")).toEqual(new Uint8Array([0xda, 0x0d, 0xf8, 0x3b]));
  });
  it("strips whitespace", () => {
    expect(decodeHexBytes(" DA 0D F8 3B ")).toEqual(new Uint8Array([0xda, 0x0d, 0xf8, 0x3b]));
  });
  it("rejects odd-length strings", () => {
    expect(() => decodeHexBytes("ABC")).toThrow(XdfParseError);
  });
});

describe("parseXdf — minimal synthetic", () => {
  const xml = `<?xml version="1.0"?>
<XDFFORMAT version="1.70">
  <XDFHEADER>
    <flags>0x1</flags>
    <fileversion>9.9.9</fileversion>
    <deftitle>Test</deftitle>
    <description>Synthetic fixture</description>
    <author>tunex tests</author>
    <BASEOFFSET offset="0x10" subtract="0" />
    <DEFAULTS datasizeinbits="8" sigdigits="2" outputtype="1" signed="0" lsbfirst="1" float="0" />
    <REGION type="0xFFFFFFFF" startaddress="0x0" size="0x100" name="Bin" desc="d" />
    <CATEGORY index="0x0" name="Cat A" />
    <CATEGORY index="0x1" name="Cat B" />
  </XDFHEADER>
  <XDFCONSTANT uniqueid="0xABCD" flags="0x0">
    <title>knob</title>
    <description>A knob</description>
    <CATEGORYMEM index="0" category="1" />
    <EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x40" mmedelementsizebits="8" mmedmajorstridebits="0" mmedminorstridebits="0" />
    <units>%</units>
    <decimalpl>1</decimalpl>
    <rangehigh>100</rangehigh>
    <rangelow>0</rangelow>
    <datatype>0</datatype>
    <unittype>0</unittype>
    <MATH equation="0.5*X"><VAR id="X" /></MATH>
  </XDFCONSTANT>
  <XDFFLAG uniqueid="0x1234">
    <title>toggle</title>
    <description>A flag</description>
    <CATEGORYMEM index="0" category="0" />
    <EMBEDDEDDATA mmedaddress="0x50" mmedelementsizebits="8" />
    <mask>0x04</mask>
  </XDFFLAG>
  <XDFPATCH uniqueid="0xBEEF">
    <title>[PATCH] thing</title>
    <description>desc</description>
    <CATEGORYMEM index="0" category="1" />
    <XDFPATCHENTRY name="step 1" address="0x60" datasize="0x4" patchdata="DEADBEEF" basedata="00112233" />
  </XDFPATCH>
</XDFFORMAT>`;

  const def = parseXdf(xml);

  it("captures header metadata", () => {
    expect(def.header.fileversion).toBe("9.9.9");
    expect(def.header.deftitle).toBe("Test");
    expect(def.header.author).toBe("tunex tests");
    expect(def.header.baseOffset).toEqual({ offset: 0x10, subtract: false });
    expect(def.header.defaults.lsbfirst).toBe(true);
    expect(def.header.regions[0].size).toBe(0x100);
    expect(def.header.categories.map((c) => c.name)).toEqual(["Cat A", "Cat B"]);
  });

  it("parses XDFCONSTANT with its MATH", () => {
    const c = def.items.find((i) => i.kind === "constant") as XdfConstant;
    expect(c.title).toBe("knob");
    expect(c.embed.address).toBe(0x40);
    expect(c.embed.elementsizebits).toBe(8);
    expect(c.units).toBe("%");
    expect(c.rangehigh).toBe(100);
    expect(c.mathEquation).toBe("0.5*X");
    // CATEGORYMEM category="1" is 1-based → points at the first header
    // category (index 0). Synthetic file places this constant in
    // category 0 ("Cat A") via category="1".
    expect(c.categoryIndices).toEqual([0]);
  });

  it("parses XDFFLAG", () => {
    const f = def.items.find((i) => i.kind === "flag") as XdfFlag;
    expect(f.mask).toBe(0x04);
    expect(f.embed.address).toBe(0x50);
  });

  it("parses XDFPATCH and decodes hex payloads", () => {
    const p = def.items.find((i) => i.kind === "patch") as XdfPatch;
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0].patchdata).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(p.entries[0].basedata).toEqual(new Uint8Array([0x00, 0x11, 0x22, 0x33]));
    expect(p.entries[0].datasize).toBe(0x4);
  });

  it("rejects non-XDFFORMAT roots", () => {
    expect(() => parseXdf("<other/>")).toThrow(XdfParseError);
  });
});

// Fixture-driven coverage against the real community patchlists when
// present on the test machine. CI runners won't have these files —
// the test is skipped, not failed.
const MS42 = join(homedir(), "Downloads/Siemens_MS42_0110C6_Community_Patchlist_v1.7.1.xdf");
const MS43 = join(homedir(), "Downloads/Siemens_MS43_MS430069_Community_Patchlist_v2.9.2.xdf");
const MS43_FULL_64K = join(homedir(), "Downloads/Siemens_MS43_430069_64K.xdf");
const MS43_FULL_512K = join(homedir(), "Downloads/Siemens_MS43_430069_512K.xdf");

describe.skipIf(!existsSync(MS43))("VIN table — end-to-end address resolution", () => {
  it("computes byte addresses for every cell of the VIN table", async () => {
    const { resolveEmbedded, tableCellAddress } = await import("./embedded");
    const { resolveAddress } = await import("./index");
    const def = parseXdf(readFileSync(MS43, "utf8"));
    const vin = def.items.find(
      (i) => i.kind === "table" && i.title === "UIF Vehicle Identification Number",
    );
    expect(vin).toBeDefined();
    if (!vin || vin.kind !== "table") return;
    const z = vin.axes.find((a) => a.id === "z");
    expect(z).toBeDefined();
    if (!z) return;

    // Spec the editor would compute.
    const spec = resolveEmbedded(z.embed, def.header.baseOffset, def.header.defaults);
    expect(spec.address).toBe(0x3c40);
    expect(spec.sizeBits).toBe(8);
    expect(spec.signed).toBe(false);
    expect(spec.lsbfirst).toBe(true);
    expect(spec.float).toBe(false);

    // Z embed metadata.
    expect(z.embed.rowcount).toBe(14);
    expect(z.embed.colcount).toBe(13);
    expect(z.embed.minorstridebits).toBe(272);
    expect(z.embed.majorstridebits).toBe(0);

    // Walk every cell — must produce non-null, byte-aligned addresses
    // strictly within the 0x80000-byte firmware region.
    const region = def.header.regions[0];
    expect(region.size).toBe(0x80000);
    for (let r = 0; r < z.embed.rowcount; r++) {
      for (let c = 0; c < z.embed.colcount; c++) {
        const cellAddr = tableCellAddress(z.embed, r, c);
        expect(cellAddr).not.toBeNull();
        const absAddr = resolveAddress(cellAddr!, def.header.baseOffset);
        expect(absAddr).toBeGreaterThanOrEqual(region.startaddress);
        expect(absAddr).toBeLessThan(region.startaddress + region.size);
      }
    }
  });
});

describe.skipIf(!existsSync(MS43_FULL_64K))("parseXdf — full MS43 64K", () => {
  it("parses the file end-to-end and resolves shared axes via embedinfo", () => {
    const def = parseXdf(readFileSync(MS43_FULL_64K, "utf8"));
    expect(def.items.length).toBeGreaterThan(100);

    // Every embedinfo on every axis must point at an item that
    // actually exists in this file — broken links would render as
    // numeric indices instead of meaningful axis labels.
    const byId = new Map(def.items.map((i) => [i.uniqueid, i]));
    let linkedAxisCount = 0;
    let resolvedAxisCount = 0;
    for (const item of def.items) {
      if (item.kind !== "table") continue;
      for (const axis of item.axes) {
        if (!axis.embedInfo) continue;
        linkedAxisCount++;
        const target = byId.get(axis.embedInfo.linkObjId);
        if (target) resolvedAxisCount++;
      }
    }
    expect(linkedAxisCount).toBeGreaterThan(100);
    // Real files reference local items by uniqueid. Some files leave a
    // handful of dangling refs (≈ 3 / 1200 in the MS43 64K dump);
    // require almost-all to resolve rather than every single one.
    expect(resolvedAxisCount / linkedAxisCount).toBeGreaterThan(0.99);
  });
});

describe.skipIf(!existsSync(MS43_FULL_512K))("parseXdf — full MS43 512K", () => {
  it("parses without throwing and exercises table + constant + flag", () => {
    const def = parseXdf(readFileSync(MS43_FULL_512K, "utf8"));
    expect(def.items.length).toBeGreaterThan(100);
    const kinds = new Set(def.items.map((i) => i.kind));
    expect(kinds.has("table")).toBe(true);
    expect(kinds.has("constant")).toBe(true);
  });
});

describe.skipIf(!existsSync(MS42) || !existsSync(MS43))("parseXdf — real .xdf fixtures", () => {
  it("parses the MS42 community patchlist", () => {
    const def = parseXdf(readFileSync(MS42, "utf8"));
    expect(def.header.deftitle).toContain("MS42");
    expect(def.items.length).toBeGreaterThan(50);
    const patches = def.items.filter((i) => i.kind === "patch");
    expect(patches.length).toBeGreaterThan(5);
  });

  it("parses the MS43 community patchlist with tables, flags, patches", () => {
    const def = parseXdf(readFileSync(MS43, "utf8"));
    expect(def.header.deftitle).toContain("MS43");
    const kinds = new Set(def.items.map((i) => i.kind));
    expect(kinds.has("constant")).toBe(true);
    expect(kinds.has("flag")).toBe(true);
    expect(kinds.has("patch")).toBe(true);
    expect(kinds.has("table")).toBe(true);

    // Sanity: every CONSTANT has a non-empty MATH equation, and every
    // PATCH has at least one entry with equal-length basedata/patchdata.
    for (const item of def.items) {
      if (item.kind === "constant") {
        expect(item.mathEquation.length).toBeGreaterThan(0);
      }
      if (item.kind === "patch") {
        expect(item.entries.length).toBeGreaterThan(0);
        for (const e of item.entries) {
          expect(e.patchdata.length).toBe(e.datasize);
          // basedata is optional for destructive patches (e.g.
          // Clear ISN Data) — only enforce size parity when present.
          if (e.basedata.length > 0) {
            expect(e.basedata.length).toBe(e.patchdata.length);
          }
        }
      }
    }
  });
});
