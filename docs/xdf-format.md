# XDF file format

TunerPro `.xdf` files describe the layout of a firmware binary —
named constants, flags, multi-region patches, and N-dimensional
tables. They're plain XML, version-attributed at the root
(`<XDFFORMAT version="1.70">`).

This document captures the format **as the tunex parser consumes it**,
which is the subset exercised by the MS41 / MS42 / MS43 community
patchlists. Wider TunerPro features (3D tables, encrypted segments,
embedded checksum metadata) are out of scope for v0 and noted where
relevant.

## High-level shape

```
<XDFFORMAT version="…">
  <XDFHEADER>
    <flags>                              <!-- file-level flag bits -->
    <fileversion>                        <!-- author's version string -->
    <deftitle>
    <description>
    <author>
    <BASEOFFSET offset="…" subtract="…"/>
    <DEFAULTS datasizeinbits=… signed=… lsbfirst=… float=… .../>
    <REGION type="…" startaddress="…" size="…" name="…" desc="…"/>
    <CATEGORY index="0x0" name="…"/>
    …
  </XDFHEADER>

  <XDFCONSTANT  uniqueid="…">…</XDFCONSTANT>
  <XDFFLAG      uniqueid="…">…</XDFFLAG>
  <XDFPATCH     uniqueid="…">…</XDFPATCH>
  <XDFTABLE     uniqueid="…">…</XDFTABLE>
  …
</XDFFORMAT>
```

Numbers come in two flavours:

- **Hex**: `"0xFF"` (case-insensitive prefix). Negative is `"-0x10"`.
- **Decimal**: `"255"`, `"-48.0"`.

The same attribute can be either — parsers must accept both.

## XDFHEADER

### `<BASEOFFSET offset subtract>`

Added to (or subtracted from) every `mmedaddress` to produce the
absolute byte index in the firmware. `subtract="1"` flips the sign.
Both community patchlists ship `offset="0"`, so non-zero base offsets
are unverified in the wild — tunex applies it uniformly to embed
addresses and patch-entry addresses.

```xml
<BASEOFFSET offset="0" subtract="0" />
```

### `<DEFAULTS …>`

File-level fallbacks for items that omit per-element attributes:

| Attribute         | Meaning |
|-------------------|---------|
| `datasizeinbits`  | Default `mmedelementsizebits` (8 in practice). |
| `sigdigits`       | Significant digits hint for scientific output. |
| `outputtype`      | Default display type (see [outputtype](#outputtype)). |
| `signed`          | 1 = signed integer. |
| `lsbfirst`        | 1 = little-endian. |
| `float`           | 1 = IEEE-754 float. |

```xml
<DEFAULTS datasizeinbits="8" sigdigits="2" outputtype="1"
          signed="0" lsbfirst="1" float="0" />
```

### `<REGION …>`

Describes a region of the firmware. The community files use a single
region covering the whole binary:

```xml
<REGION type="0xFFFFFFFF" startaddress="0x0" size="0x80000"
        regioncolor="0x0" regionflags="0x0"
        name="Binary File" desc="…" />
```

`size` is a useful sanity check — tunex confirms the loaded binary is
at least this large before reading.

### `<CATEGORY index name>`

Flat list of category names; `index` is a 0-based hex index referenced
indirectly by `<CATEGORYMEM>` on items. **Beware:** `CATEGORYMEM` uses
1-based indexing into this list (see the [CATEGORYMEM
quirk](#categorymem-is-1-based) below).

```xml
<CATEGORY index="0x0" name="ECU Information" />
<CATEGORY index="0x1" name="Immobilizer Bypass" />
<CATEGORY index="0x2" name="Checksum Bypass" />
```

## Item nodes — shared fields

Every item kind carries:

| Element / Attribute             | Meaning |
|----------------------------------|---------|
| `uniqueid` (attribute)           | Stable hex id for the item. |
| `<title>`                        | Display name. |
| `<description>`                  | Long description (may contain `&#013;&#010;` CRLF). |
| `<CATEGORYMEM index="N" category="M"/>` | Up to several; pins this item to header categories. |

### CATEGORYMEM is 1-based

Despite the header listing categories with `index="0x0"`, `0x1`, …,
the `category` attribute on `CATEGORYMEM` is **1-based** — it points
at the Nth header entry, where the first one is `category="1"`.
Cross-checked against the MS43 file: `<XDFPATCH title="[PATCH]
Immobilizer Bypass">` has `category="2"`, and the header lists
"Immobilizer Bypass" at `index="0x1"`.

```xml
<!-- This patch is in "Immobilizer Bypass" (header index 0x1) -->
<CATEGORYMEM index="0" category="2" />
```

tunex normalises to 0-based internally and drops `category="0"` entries
(nothing in the wild uses 0).

A single item can carry multiple `CATEGORYMEM` slots for cross-listing
across categories. Real files occasionally duplicate the same category
across two slots — dedupe before grouping or you'll render the item
twice.

## EMBEDDEDDATA

Describes where + how an item's bytes live in the firmware. Used by
constants, flags, and table axes. Captured fields:

| Attribute               | Meaning |
|-------------------------|---------|
| `mmedtypeflags`         | Bit-flags: `0x01` signed, `0x02` lsbfirst, `0x04` float. When the attribute is zero or absent, fall back to `<DEFAULTS>`. |
| `mmedaddress`           | Byte address (pre-BASEOFFSET). Omitted on label-only axes. |
| `mmedelementsizebits`   | Cell size in bits (8, 16, 32, 64). Falls back to `datasizeinbits`. |
| `mmedrowcount`          | Row count for table z-data. |
| `mmedcolcount`          | Column count for table z-data. |
| `mmedmajorstridebits`   | Bits between consecutive columns within a row (within-row step). |
| `mmedminorstridebits`   | Bits between the start of the last column of row `r` and the start of column 0 of row `r+1` (tail stride). |

A canonical scalar:

```xml
<EMBEDDEDDATA mmedtypeflags="0x02"
              mmedaddress="0x70CFA"
              mmedelementsizebits="8"
              mmedmajorstridebits="0"
              mmedminorstridebits="0" />
```

A 2D table z-data:

```xml
<EMBEDDEDDATA mmedaddress="0x3C40"
              mmedelementsizebits="8"
              mmedrowcount="14" mmedcolcount="46"
              mmedmajorstridebits="0" mmedminorstridebits="0" />
```

### Stride formula

Cells in a table are addressed by:

```
within_row_step = mmedmajorstridebits != 0 ? mmedmajorstridebits : elementsizebits
tail_stride     = mmedminorstridebits != 0 ? mmedminorstridebits : elementsizebits

row_pitch_bits  = tail_stride + (max(cols, 1) - 1) * within_row_step
cell_bits(r,c)  = r * row_pitch_bits + c * within_row_step
cell_byte(r,c)  = embed.address + cell_bits(r,c) / 8        when divisible by 8
```

The convention captures three real layouts that the MS43 file uses:

1. **Contiguous row-major** — strides 0 / 0; the table's `cols * ele`
   bytes per row are packed end-to-end.
2. **Sub-view of a larger table** — e.g. the VIN sub-table reads 13
   columns out of each row of the 14×46 "User Information Fields"
   parent table. `mmedcolcount="13"` with `mmedminorstridebits="272"`
   gives a row pitch of 46 bytes (matching the parent), letting the
   smaller view share the same `mmedaddress`.
3. **1D column** — `mmedcolcount` omitted (parser stores 0; formula
   treats as 1). Each "row" is one cell stepped by `tail_stride` bits.

Non-zero strides are widely used; tunex renders all three.

## XDFCONSTANT — single scalar

```xml
<XDFCONSTANT uniqueid="0x5FA5" vislevel="1" flags="0xC">
  <title>c_tco_min_cp</title>
  <description>Coolant temperature threshold for STB_CP.</description>
  <CATEGORYMEM index="0" category="9" />
  <EMBEDDEDDATA mmedtypeflags="0x02" mmedaddress="0x70CFA"
                mmedelementsizebits="8"
                mmedmajorstridebits="0" mmedminorstridebits="0" />
  <units>&#176;C</units>
  <decimalpl>1</decimalpl>
  <rangehigh>142.500000</rangehigh>
  <rangelow>-48.000000</rangelow>
  <datatype>0</datatype>
  <unittype>0</unittype>
  <DALINK index="0" />
  <MATH equation="0.75*X-48.0">
    <VAR id="X" />
  </MATH>
</XDFCONSTANT>
```

| Element        | Notes |
|----------------|-------|
| `<units>`      | Free-form display string (UTF-8 entities allowed). |
| `<decimalpl>`  | Decimal places for fixed-point display. Default `2` if absent (XDFAXIS only emits when ≠ 2). |
| `<rangelow>` / `<rangehigh>` | Soft min/max in engineering units. Used to clamp UI edits. |
| `<datatype>` / `<unittype>` | Enumerations; meaning is TunerPro-internal. tunex preserves the values. |
| `<DALINK index>` | Data-acquisition link slot; out of scope for v0. |
| `<MATH equation="…">` | Raw→engineering conversion. See [MATH grammar](#math-grammar). |

## XDFFLAG — single bit

```xml
<XDFFLAG uniqueid="0x52F5">
  <title>lv_mil_knk_lv_1</title>
  <description>Activate knock light during light knock.</description>
  <CATEGORYMEM index="0" category="12" />
  <EMBEDDEDDATA mmedaddress="0x707D0" mmedelementsizebits="8"
                mmedmajorstridebits="0" mmedminorstridebits="0" />
  <mask>0x01</mask>
</XDFFLAG>
```

`<mask>` selects which bit of the byte at `mmedaddress` carries the
flag. Multiple `XDFFLAG`s can share the same `mmedaddress` with
different masks — that's how a byte of independent toggles is
described.

## XDFPATCH — apply / revert bundle

```xml
<XDFPATCH uniqueid="0x3AF2">
  <title>[PATCH] Immobilizer Bypass</title>
  <description>Disables the immobilizer checks of the ECU.</description>
  <CATEGORYMEM index="0" category="2" />
  <XDFPATCHENTRY name="Patch Jump"   address="0x600D8"
                 datasize="0x4"
                 patchdata="DA0DF83B" basedata="DA0A6CDD" />
  <XDFPATCHENTRY name="Patch Code"   address="0x53BF8"
                 datasize="0x8"
                 patchdata="DA0AE4FC0E1ADB00"
                 basedata="0000FFFFFFFFFFFF" />
</XDFPATCH>
```

Each `<XDFPATCHENTRY>` carries:

| Attribute  | Meaning |
|------------|---------|
| `name`     | Display name for the entry. |
| `address`  | Byte address (pre-BASEOFFSET). |
| `datasize` | Length in bytes. Equals `patchdata.length`. |
| `patchdata`| Hex string of the bytes after applying the patch. |
| `basedata` | Hex string of the original bytes. **May be empty** for destructive patches (e.g. "Clear ISN Data" — wipes a region with no defined prior state). |

A patch is **applied** when every entry's bytes match `patchdata`;
**virgin** when every entry's bytes match `basedata` (and `basedata`
is present); **mixed** otherwise. Revert-to-virgin is impossible
when `basedata` is empty.

## XDFTABLE — N-dimensional table

A table has 1–3 `<XDFAXIS>` children, identified by `id="x"`,
`id="y"`, and `id="z"`.

| Axis | Role                                            |
|------|-------------------------------------------------|
| `x`  | Column dimension. `<indexcount>` = column count. |
| `y`  | Row dimension. `<indexcount>` = row count.       |
| `z`  | Data — its `EMBEDDEDDATA` is where the bytes live. |

Note: when TunerPro reads a table, **the column count comes from the
X axis `<indexcount>` and the row count comes from the Y axis
`<indexcount>`** (verified against the deserialiser). Top-level
`<rowcount>` / `<colcount>` elements override those when present, but
real files almost never use them. The Z embed's `mmedrowcount` /
`mmedcolcount` describe the same dimensions for the data side.

```xml
<XDFTABLE uniqueid="0x1AB3" flags="0x0">
  <title>User Information Fields</title>
  <CATEGORYMEM index="0" category="1" />

  <XDFAXIS id="x" uniqueid="0x0">
    <EMBEDDEDDATA mmedtypeflags="0x02" mmedelementsizebits="8"
                  mmedmajorstridebits="-32" mmedminorstridebits="0" />
    <indexcount>46</indexcount>
    <outputtype>4</outputtype>
    <datatype>0</datatype>
    <unittype>0</unittype>
    <LABEL index="0"  value="VIN" />
    <LABEL index="1"  value="VIN" />
    …
    <MATH equation="X"><VAR id="X" /></MATH>
  </XDFAXIS>

  <XDFAXIS id="y" uniqueid="0x0">
    <EMBEDDEDDATA mmedtypeflags="0x02" mmedelementsizebits="8"
                  mmedmajorstridebits="-32" mmedminorstridebits="0" />
    <indexcount>14</indexcount>
    <LABEL index="0" value="UIF 01" />
    …
    <MATH equation="X"><VAR id="X" /></MATH>
  </XDFAXIS>

  <XDFAXIS id="z">
    <EMBEDDEDDATA mmedaddress="0x3C40" mmedelementsizebits="8"
                  mmedrowcount="14" mmedcolcount="46"
                  mmedmajorstridebits="0" mmedminorstridebits="0" />
    <decimalpl>0</decimalpl>
    <min>0.000000</min>
    <max>255.000000</max>
    <outputtype>3</outputtype>
    <MATH equation="X"><VAR id="X" /></MATH>
  </XDFAXIS>
</XDFTABLE>
```

### Axes carry rich metadata

X/Y axes typically have no `mmedaddress` (they're purely label-driven
when their `<EMBEDDEDDATA>` has no address) or they read derived values
from the firmware (axis values). They also carry per-axis `<decimalpl>`,
`<units>`, `<min>`, `<max>`, `<outputtype>`, and a `<MATH>` block — used
to format the row / column headers when the axis isn't backed by
explicit `<LABEL>` entries.

A negative `mmedmajorstridebits` on a label-only axis (e.g. `-32`) is a
TunerPro convention indicating "no actual byte stride — treat this as a
labels-only dimension". tunex ignores it for X/Y axes because the
parser doesn't read those bytes anyway.

### Axis `<MATH>` `row` / `col` attributes

`<MATH>` inside an `<XDFAXIS id="z">` can carry `row` and `col`
attributes that scope the equation to a specific cell. Most real files
don't use this; tunex parses the equation but doesn't yet apply
per-cell overrides.

## `<MATH>` grammar

Conversion equations are simple infix arithmetic. The grammar tunex
accepts (which covers every `.xdf` I've inspected):

```
expression : term (('+' | '-') term)*
term       : factor (('*' | '/') factor)*
factor     : '-' factor | '(' expression ')' | NUMBER | IDENT
NUMBER     : /-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/
IDENT      : 'X' | 'Y' | 'Z'        // axis cell variables
```

Examples seen in real files:

| Equation         | Meaning                                |
|------------------|-----------------------------------------|
| `X`              | Identity. Raw byte = engineering value. |
| `0.75*X-48.0`    | Coolant temp scale (raw 0…255 → °C). |
| `X*0.01`         | Centiseconds (raw 100 → 1.0 s).         |
| `X-100`          | Bias correction.                        |

tunex detects **linear forms** (`a*X + b` with `a, b ∈ ℝ`) and
produces an analytical inverse for write-back. Non-linear MATH
(`X*X`, `1/X`, branches) falls through to raw-value editing in the UI.

## `outputtype`

Per-axis / per-constant integer enum chosen by the file author. The
values observed in the wild:

| Value | Likely meaning             |
|-------|----------------------------|
| `1`   | Decimal (`%.*lf`). Default. |
| `2`   | Hexadecimal (`%X`).         |
| `3`   | Binary or hex-emphasised.   |
| `4`   | ASCII / label.              |

These haven't been exhaustively cross-checked; tunex preserves the
value but only acts on `4` (axis labels render as the explicit
`<LABEL>` text rather than as numbers).

## Endianness, signedness, floats

All three are governed by `mmedtypeflags`:

| Bit  | Mask    | Meaning                |
|------|---------|------------------------|
| 0    | `0x01`  | Signed                 |
| 1    | `0x02`  | LSB-first (little-endian) |
| 2    | `0x04`  | IEEE-754 float          |

Real files almost always set `0x02` only (unsigned little-endian
integer). The CPU side of MS41/MS42/MS43 ECUs is big-endian; the
TunerPro convention is to author `.xdf` files as little-endian and
let TunerPro endianness-swap on write. tunex follows the same
convention — bytes are written in the byte order the `mmedtypeflags`
declares.

## Known gaps (v0)

- **3D tables** — none of the BMW ECU XDF files I've encountered
  actually use a 3-axis-data layout; the convention is 2D tables
  with x and y axes (often shared via `<embedinfo>`) and z as the
  data. If a true 3D file surfaces, the parser will need a 3-D embed
  type plus a slice-selector UI.
- **`<DALINK>`** — data-acquisition reference (live ECU). Out of
  scope for an offline editor.

## Reference files

- [`Siemens_MS42_0110C6_Community_Patchlist_v1.7.1.xdf`](https://github.com/emdzej/tunex/blob/main/packages/xdf-parser/src/index.test.ts) — small, covers constants + flags + patches.
- [`Siemens_MS43_MS430069_Community_Patchlist_v2.9.2.xdf`](https://github.com/emdzej/tunex/blob/main/packages/xdf-parser/src/index.test.ts) — exercises every parser path (constants, flags, patches, 1D / 2D tables, strided sub-views).

Both ship parser-test fixtures when present on the dev machine; CI
runs without them and skips fixture-driven asserts gracefully.
