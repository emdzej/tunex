# Changelog

All notable changes to this project are documented here. Versions
follow [Semantic Versioning](https://semver.org/). Format adapted
from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — 2026-06-02

Second pre-release. Focus: full-file XDF support, structured-editor
polish, and a much friendlier hex / interpretation workflow.

### Added — `@tunex/xdf-parser`

- `<embedinfo type linkobjid>` parsed on axes; `XdfAxis.embedInfo`
  carries the link. Verified end-to-end against the full MS43 64K /
  512K reference XDFs (1233 of 1236 cross-references resolve; the 3
  dangling refs are stale in the source file).
- `XdfConstant.outputtype` now captured.
- Encrypted XDF detection — `parseXdf` throws an `XdfParseError` up
  front when `<openpassword>` / `<modifypassword>` is set on the
  header.
- `CATEGORYMEM category="N"` normalised from 1-based to 0-based at
  parse time and deduped — items with two slots pointing at the same
  category appear once instead of twice.
- Stride formula for non-contiguous table sub-views:
  `tail_stride + (cols - 1) * within_row_step`. Decoded with the help
  of the MS43 UIF VIN / DATE / SOFT sub-tables.
- 67 unit tests (up from 58), including fixtures against the full
  MS43 64K + 512K dumps.

### Added — Structured editor

- Axis labels follow `embedinfo` links — shared RPM / load axes
  render with their actual values across every table that references
  them.
- Tables: heatmap colouring (default on) — cell backgrounds map to
  the z-axis range with a cool→warm gradient.
- Tables: hex / decimal display toggle. Defaults to hex for 8-bit
  unsigned cells and for any cell whose z axis declared
  `outputtype="3"`; decimal otherwise.
- Tables: integer cells render without trailing `.00`; numeric-looking
  axis labels (`0.00` → `0`) collapse the same way.
- Tables: inline diagnostic banner explains why a cell read returned
  null (embed values, address, firmware length) instead of just
  rendering "—".
- Constants flagged `outputtype="3"` default to hex display; navigating
  between constants snaps back to each one's author-preferred mode.
- XDF file swap remounts the tree so search filter and per-category
  collapse state reset to the new file's contents.
- Encrypted XDFs surface in the error banner instead of populating
  the tree with garbled items.

### Added — RAW editor

- Clickable contents cells — each element in the right-column
  contents view (text mode + bars mode) is now a click target. Clicks
  set `app.cursorSize` so a `u16` click highlights two bytes, a `u32`
  click highlights four.
- "At cursor" interpretation panel reworked: paired LE/BE columns
  halve the vertical height, the panel collapses to a single header
  via a chevron (state persists in ui-prefs), the edit-as-type input
  auto-populates with the cursor's current value, and a `dec / hex`
  toggle switches the input base (hidden on float types).
- Hex view scroll container picks up `px-3 py-2` inner padding so the
  byte rows no longer hug the window edge.
- Cell click targets are wide enough to hit comfortably even for
  single ASCII characters.

### Changed

- Version source moved from `apps/web/package.json` to the workspace
  root `package.json` — a single bump propagates to the header pill,
  the release URL, and the bimmerz-hub tile.

### Fixed

- Structured tree no longer crashes with "duplicate each key" when an
  item lists the same `CATEGORYMEM` slot twice (parser-side dedupe +
  resilient composite key on the `each` block).
- "ECU Information" category now populates correctly (was empty due
  to the 1-based CATEGORYMEM bug).
- CI typecheck failure in the embedded-data tests (a stray
  `void {} as XdfEmbeddedData` placeholder + missing rowcount/colcount
  defaults in the test helper).
- Pages deploy now serves from the custom domain (`tunex.bimmerz.app`)
  rather than a `/tunex/` sub-path; CNAME emitted in the workflow.

### Docs

- `docs/xdf-format.md` documents the .xdf XML schema as the parser
  sees it — header, item kinds, EMBEDDEDDATA stride formula,
  CATEGORYMEM quirk, MATH grammar, `mmedtypeflags` bit layout, and
  the open-gap list.
- Surrounding integration: TUNEX feature card on bimmerz.app and tile
  in bimmerz-hub.

## [0.1.0] — 2026-06-02

Initial public release.

### Added — app shell

- Svelte 5 + Vite + Tailwind SPA scaffolded as a pnpm workspace
  (`apps/web` + `packages/xdf-parser`).
- Blue accent (`#3b82f6`); `TUNEX` wordmark with the trailing `X`
  painted in the accent colour, matching the bimmerz family.
- Header carries the version (links to the matching GitHub release
  tag) and a GitHub icon linking to the repo.
- Three top-level views: file picker (landing), RAW editor,
  Structured editor.
- File picker accepts drag-and-drop and a file chooser; the loaded
  binary lives in memory only — nothing is uploaded.
- Save downloads the modified binary with a `-tunex` filename suffix.
- PWA manifest + service worker via `vite-plugin-pwa` (installable,
  works offline after the first visit).

### Added — RAW editor

- Virtualised hex view (16 bytes per row) handles multi-MB firmware
  without rendering jank.
- Cursor navigation: click any byte, arrow keys, `Home` / `End` /
  `PageUp` / `PageDown`, plus a `g` shortcut that focuses the
  jump-to-offset input.
- Jump-to-offset input accepts decimal or `0x…` hex.
- Inline hex-pair editing: double-click a byte to enter edit mode,
  type hex digits (with optional spaces — `FF AA CC`), `Enter`
  commits, `Esc` cancels. Pending bytes overlay in the accent colour
  and the toolbar shows a live "Editing N bytes typed" banner.
- Data-interpretation side panel: byte at cursor read as u8/i8,
  u16/i16/u32/i32 (LE + BE), f32/f64 (LE + BE), ASCII char, UTF-8
  codepoint.
- Edit-at-cursor as a chosen type writes the encoded bytes back to
  the buffer.
- Contents-column toggle: ASCII (default), u8 / u16 LE / u16 BE /
  i16 LE / i16 BE / u32 LE / i32 LE.
- Optional "bars" rendering for numeric contents modes — horizontal
  bars scaled to the type's range (centre-zero for signed types).
  Helps spot table boundaries and curve shapes at a glance.
- Bookmarks panel with named offsets, descriptions, and one level of
  user-defined folders. Click a bookmark to jump the cursor; bookmark
  state persists to `localStorage`. Folder delete moves bookmarks
  into the synthetic "Root" folder (non-destructive).
- Resizable divider between the hex view and the right sidebar;
  width persists to `localStorage`. Keyboard-accessible
  (Arrow Left / Right with optional Shift for larger steps).

### Added — Structured editor

- Load any TunerPro `.xdf` definition file; parse errors surface in
  an inline panel rather than crashing the view.
- Left rail: category tree with item counts, collapse/expand,
  search-as-you-type filter, per-kind colour-coded icons
  (Constant / Flag / Patch / Table).
- Right pane: per-item editor that dispatches on kind:
  - **Constant** — engineering value via the `MATH` equation, edit +
    write through the linear inverse, with raw-value fallback for
    non-linear math. Shows units, range, and decimalpl.
  - **Flag** — single-bit checkbox toggling the masked bit.
  - **Patch** — per-entry applied / virgin / mixed state, with
    Apply / Revert at the entry and the whole-patch level (the
    "virginise" workflow). Destructive patches without `basedata`
    apply but can't be reverted; the UI surfaces that.
  - **Table** — row/column grid with axis labels, inline cell
    editing, dec/hex toggle (8-bit unsigned only), heatmap colouring
    (on by default) using the z-axis `<min>`/`<max>` or scanned
    cell range.
- Cross-link to the hex view: selecting an item highlights its
  byte range; a "Jump 0x… →" button switches to RAW with the cursor
  seated on the item's start.
- XDF file replace force-remounts the tree so internal UI state
  (collapse, search) resets to the new file's contents.

### Added — `@tunex/xdf-parser`

- Pure-TypeScript parser. XML parsing via `@xmldom/xmldom` for
  deterministic behaviour in both browser and Node tests.
- Public types: `XdfDefinition`, `XdfHeader`, `XdfCategory`,
  `XdfBaseOffset`, `XdfDefaults`, `XdfRegion`, `XdfConstant`,
  `XdfFlag`, `XdfPatch`, `XdfPatchEntry`, `XdfTable`, `XdfAxis`,
  `XdfAxisLabel`, `XdfEmbeddedData`.
- `parseXdf(xml)` — walks header (`BASEOFFSET`, `DEFAULTS`,
  `REGION`, `CATEGORY`) and items (`XDFCONSTANT`, `XDFFLAG`,
  `XDFPATCH`/`XDFPATCHENTRY`, `XDFTABLE` with `XDFAXIS` children).
  Hex strings decode to `Uint8Array`. CATEGORYMEM normalisation
  (1-based → 0-based) + dedupe of repeated category slots.
- `math.ts` — recursive-descent parser for the MATH grammar
  (`+ - * /`, parens, unary minus, numbers, `X`/`Y`/`Z` variables).
  Linear-form inverter for write-back (`aX + b`); non-linear
  expressions fall through to raw editing.
- `embedded.ts` — `resolveEmbedded` (typeflags-based spec),
  `readScalar`/`encodeScalar` (u8…u64 + f32/f64, LE/BE),
  `readFlag`/`applyFlag`, `patchEntryState`,
  `tableCellAddress` with the strided cell-addressing formula
  (`tail_stride + (cols - 1) * within_row_step`).
- 64 unit tests, including fixture-driven coverage against the
  MS42 and MS43 community patchlists when those files are present
  on the test machine.

### Added — CI / deployment

- `.github/workflows/ci.yml` — parallel typecheck / lint / test /
  build jobs on push + pull request.
- `.github/workflows/deploy-web.yml` — manual `workflow_dispatch`
  deploy to GitHub Pages, with `CNAME` for `tunex.bimmerz.app`.
- Vite `base` parameterised via `TUNEX_BASE_PATH` so the same build
  can serve from a sub-path or the domain root.

[0.2.0]: https://github.com/emdzej/tunex/releases/tag/0.2.0
[0.1.0]: https://github.com/emdzej/tunex/releases/tag/0.1.0
