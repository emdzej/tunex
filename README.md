# tunex

Web-based ECU firmware editor following TunerPro conventions. Load a
binary, edit it as raw hex, or use a TunerPro `.xdf` definition to edit
named constants, flags, patches and tables in a structured tree. Save
the modified binary back to disk.

Everything runs in the browser. No server, no upload — firmware bytes
stay on your machine.

Live: <https://tunex.bimmerz.app>

## What it does

**RAW editor**

- Virtualised hex view (16 bytes / row) that handles multi-MB firmware
  without jank.
- Cursor via click + arrow keys + `Home` / `End` / `PageUp` / `PageDown`.
- `g` jumps focus to the go-to-offset input; type decimal or `0x…` hex.
- "At cursor" interpretation panel — paired LE/BE columns for every
  multi-byte type (u16, i16, u32, i32, f32, f64) plus u8/i8, ASCII,
  and UTF-8. Collapsible to a single header row when you don't need
  it.
- Edit-as-type input auto-populates with the cursor's current value;
  flip the input base between decimal and hex; submit to write back.
- Double-click any byte to start an inline hex-pair edit
  (type `FF AA CC…`, `Enter` commits, `Esc` cancels).
- Right-column contents view toggleable to ASCII / u8 / u16 / i16 /
  u32 / i32 with an optional bars-mode visualisation. **Click any
  element** to jump the cursor to its byte range — a u16 click
  highlights two bytes, a u32 four.
- Bookmarks: named offsets with descriptions, organised into one level
  of user-defined folders, persisted to `localStorage`.
- Resizable divider between the hex view and the right sidebar
  (drag, or focus and use Left/Right with Shift for larger steps).

**Structured editor**

- Open a TunerPro `.xdf` definition file (independent of the firmware —
  the same `.xdf` usually covers multiple binary versions of one ECU).
  Encrypted files are detected and surfaced with a clear error.
- Left rail: categories with item counts, collapsible, with a
  search-as-you-type filter. Tree state resets when you replace the
  `.xdf`.
- Per-kind editors:
  - `XDFCONSTANT` — read engineering value via the `MATH` equation,
    write back through the inverse for linear forms (`aX+b`). Non-linear
    MATH falls back to raw-value entry. Author-declared
    `outputtype="3"` pre-selects hex display.
  - `XDFFLAG` — checkbox toggling the masked bit.
  - `XDFPATCH` — per-entry applied / virgin / neither state badges;
    Apply or Revert per entry, plus whole-patch Apply / Revert-to-virgin
    (the "virginise" workflow). Destructive patches without `basedata`
    (e.g. "Clear ISN Data") apply but can't be reverted.
  - `XDFTABLE` — row/column grid with axis labels resolved through
    `<embedinfo>` (shared RPM / load axes resolve automatically),
    inline cell editing, dec/hex toggle, heatmap colouring by value
    (on by default), and support for non-contiguous sub-views via
    the stride formula.
- Selecting an item highlights its byte range in the hex view, and the
  "Jump 0x… →" button switches to the RAW tab with the cursor seated at
  the item's start.

## Project layout

```
tunex/
├── apps/web/                       # Svelte 5 + Vite + Tailwind SPA
│   ├── src/
│   │   ├── App.svelte
│   │   ├── components/             # FilePicker, HexView, BookmarksPanel, XdfTreePanel, …
│   │   └── lib/
│   │       ├── state.svelte.ts     # Top-level $state, view + binary + xdf
│   │       ├── bookmarks.svelte.ts # Bookmarks store + localStorage persistence
│   │       ├── ui-prefs.svelte.ts  # Sidebar width etc.
│   │       ├── interpret.ts        # Numeric read/encode + ASCII / UTF-8 helpers
│   │       └── format.ts           # hex / offset parsing helpers
│   ├── tailwind.config.ts          # @emdzej/bimmerz-theme preset + blue accent
│   └── vite.config.ts
├── packages/xdf-parser/            # Pure TS, no Svelte/DOM deps
│   └── src/
│       ├── index.ts                # parseXdf → XdfDefinition, types
│       ├── math.ts                 # MATH parser + evaluator + linear inverter
│       ├── embedded.ts             # readScalar / encodeScalar / patchEntryState …
│       └── *.test.ts               # Vitest, runs against MS42/MS43 fixtures
└── .github/workflows/
    ├── ci.yml                      # typecheck / lint / test / build on push + PR
    └── deploy-web.yml              # Manual Pages deploy with CNAME
```

## Getting started

Prerequisites: Node 22+, pnpm 10.33+.

```bash
pnpm install
pnpm web        # dev server at http://localhost:5176/
```

Other workspace scripts:

```bash
pnpm typecheck  # tsc + svelte-check across both packages
pnpm test       # vitest in @tunex/xdf-parser
pnpm lint       # svelte-check (lint = static analysis at v0)
pnpm build      # production build (apps/web + packages/xdf-parser)
```

`pnpm dev` is an alias of `pnpm web`.

## Deployment

The deploy workflow is manual-trigger only — open the **Actions** tab on
GitHub and click **Deploy web to GitHub Pages → Run workflow**. The job
builds `apps/web`, writes `CNAME` for `tunex.bimmerz.app`, and uploads
the dist as the Pages artifact.

One-time setup in the repo: **Settings → Pages → Source = GitHub
Actions**.

## XDF support — scope and caveats

- The two community patchlists (`Siemens_MS42_*.xdf` and
  `Siemens_MS43_*.xdf`) parse end-to-end and exercise constant, flag,
  patch and table paths.
- 1D and 2D tables render — including sub-views described by non-zero
  `mmedmajorstridebits` / `mmedminorstridebits` (e.g. the MS43
  user-information-field VIN / DATE / SOFT cells).
- `BASEOFFSET` is applied uniformly to embed addresses and patch-entry
  addresses. Both fixtures use `offset="0"`, so non-zero base offsets
  are unverified.
- 3D tables (Z axis as data, with separate X and Y axes for indexing)
  aren't rendered yet — the parser captures the axes; the grid
  renderer is the missing piece.

## Tech notes

- Svelte 5 (runes — `$state`, `$derived`, `$effect`).
- Tailwind via the shared
  [`@emdzej/bimmerz-theme`](https://www.npmjs.com/package/@emdzej/bimmerz-theme)
  preset; per-app accent is blue (`#3b82f6`).
- XML parsed with `@xmldom/xmldom` for deterministic behaviour across
  Node tests and the browser.
- PWA via `vite-plugin-pwa` — installable; runs offline after the first
  visit.
- Firmware lives in a single `Uint8Array` in memory. Edits mutate that
  array directly; "Save" downloads a fresh blob.

## Related projects

`tunex` is a sister project to the
[`bimmerz`](https://github.com/emdzej) family — same shared theme,
similar workspace shape:

- [`ncsx-web`](https://github.com/emdzej/ncsx) — BMW NCS Expert coding in the browser.
- [`inpax-web`](https://github.com/emdzej/inpax) — INPA / EDIABAS over Web Serial.

## Support

If you find this project useful, consider [buying me a coffee](https://buymeacoffee.com/emdzej) or [sponsoring on GitHub](https://github.com/sponsors/emdzej) or if it's your thing: via PayPal

[![Donate with PayPal](https://www.paypalobjects.com/en_US/PL/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/donate/?business=TDBR3A97PLQRQ&no_recurring=0&item_name=%28emdzej%29&currency_code=PLN)

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for noncommercial use (personal projects, research, education, hobby tuning on your own car). Commercial use requires a separate licence — open an issue if you need one.

This repository contains no proprietary firmware, vendor data, or TunerPro source. All firmware binaries and `.xdf` definition files the tool consumes must come from sources the user has the right to use.

## Disclaimer

This project is for educational and research purposes only. It is not affiliated with TunerPro.
