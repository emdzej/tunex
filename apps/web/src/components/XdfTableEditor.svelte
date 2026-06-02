<script lang="ts">
  import type { XdfTable, XdfDefinition, XdfAxis } from "@tunex/xdf-parser";
  import {
    resolveAddress,
    compileMath,
    invertLinear,
    readScalar,
    encodeScalar,
    resolveEmbedded,
    tableCellAddress,
  } from "@tunex/xdf-parser";
  import { app, writeBytes, isRangeChanged } from "../lib/state.svelte";
  import { hex } from "../lib/format";

  interface Props {
    item: XdfTable;
    xdf: XdfDefinition;
  }
  let { item, xdf }: Props = $props();

  const xAxis = $derived(item.axes.find((a) => a.id === "x"));
  const yAxis = $derived(item.axes.find((a) => a.id === "y"));
  const zAxis = $derived(item.axes.find((a) => a.id === "z"));

  const layout = $derived.by(() => {
    if (!zAxis) return { kind: "no-z" } as const;
    const rows = Math.max(1, zAxis.embed.rowcount);
    const cols = Math.max(1, zAxis.embed.colcount);
    return { kind: "grid", rows, cols } as const;
  });

  const zSpec = $derived(
    zAxis ? resolveEmbedded(zAxis.embed, xdf.header.baseOffset, xdf.header.defaults) : null,
  );
  const zToEng = $derived.by(() => {
    if (!zAxis) return null;
    try {
      return compileMath(zAxis.mathEquation);
    } catch {
      return null;
    }
  });
  const zFromEng = $derived.by(() => {
    if (!zAxis) return null;
    try {
      return invertLinear(zAxis.mathEquation);
    } catch {
      return null;
    }
  });

  // Decimal places — TunerPro default is 2 when the axis omits the
  // attribute (confirmed via Ghidra serialiser).
  const decimalpl = $derived(zAxis?.decimalpl ?? 2);

  // Display mode toggle. Hex makes sense for two cases:
  //   - 8-bit unsigned cells (the byte-table convention).
  //   - Wider unsigned cells where the .xdf author flagged
  //     outputtype=3 (typically DTC P-codes, masks, or address-like
  //     constants where the author wanted hex display).
  // Signed and float types stay decimal — the toggle isn't shown.
  let displayMode = $state<"dec" | "hex">("hex");
  const canShowHex = $derived(
    zSpec
      ? !zSpec.float &&
          !zSpec.signed &&
          (zSpec.sizeBits === 8 || zAxis?.outputtype === 3)
      : false,
  );
  const hexWidth = $derived(zSpec ? Math.max(2, Math.ceil(zSpec.sizeBits / 4)) : 2);

  // Optional heatmap colouring per cell. On by default — most tables
  // are numeric and the gradient reveals curve shapes at a glance;
  // toggling never affects text formatting.
  let heatmap = $state(true);

  function formatValue(eng: number | null, raw: number | null): string {
    if (displayMode === "hex" && canShowHex && raw !== null) {
      // Raw bytes, uppercase, no prefix — TunerPro-style table view.
      // Mask to the cell's bit width so signed negatives wrap into the
      // unsigned representation; the `|| 0xffffffff` guards the 32-bit
      // shift overflow case (1 << 32 === 1 in JS).
      const mask = ((1 << zSpec!.sizeBits) - 1) || 0xffffffff;
      return hex(raw & mask, hexWidth);
    }
    const v = eng !== null ? eng : raw;
    if (v === null) return "—";
    // Integer values render without decimals — `255` not `255.00`.
    // Floats always keep the precision so users can still see e.g.
    // 1.0 vs 1.0000001.
    if (Number.isInteger(v) && !zSpec?.float) return v.toString();
    return v.toFixed(decimalpl);
  }

  // Heat-map domain. Prefer the .xdf-declared min/max on the Z axis
  // (matches what the file author thought was the meaningful range);
  // fall back to scanning current cell values when those aren't set.
  // Returns null when the range has zero width (all cells the same
  // value, or no readable cells), in which case heatmap colouring is
  // skipped — no useful gradient to draw.
  const heatRange = $derived.by<{ min: number; max: number } | null>(() => {
    if (!heatmap || layout.kind !== "grid") return null;
    if (
      zAxis?.min !== undefined &&
      zAxis?.max !== undefined &&
      Number.isFinite(zAxis.min) &&
      Number.isFinite(zAxis.max) &&
      zAxis.min < zAxis.max
    ) {
      return { min: zAxis.min, max: zAxis.max };
    }
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const cell = readCell(r, c);
        if (cell.raw === null) continue;
        const v = cell.eng !== null ? cell.eng : cell.raw;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return null;
    return { min: lo, max: hi };
  });

  // Cool→warm gradient (blue 240° → red 0°). Low alpha so the cell's
  // foreground text stays legible without picking a contrast colour
  // per cell.
  function heatColor(eng: number | null, raw: number | null): string | null {
    if (!heatRange) return null;
    const v = eng !== null ? eng : raw;
    if (v === null) return null;
    const t = Math.max(0, Math.min(1, (v - heatRange.min) / (heatRange.max - heatRange.min)));
    const hue = 240 * (1 - t);
    return `hsla(${hue.toFixed(0)}, 70%, 50%, 0.35)`;
  }

  /**
   * Resolve an axis's labels — following an embedinfo link when set.
   *
   * Real-world ECU XDFs share axis definitions across many tables (one
   * canonical RPM scale, one canonical load scale, etc.) via
   * `<embedinfo type="3" linkobjid="0x…"/>`. The linked uniqueid points
   * at another XDFTABLE whose axes carry the actual label / value list;
   * tunex walks the link and picks the axis whose `indexcount` matches
   * ours.
   */
  function resolveLabels(axis: XdfAxis): { index: number; value: string }[] {
    if (axis.labels.length > 0 || !axis.embedInfo) return axis.labels;
    const linked = xdf.items.find((i) => i.uniqueid === axis.embedInfo!.linkObjId);
    if (!linked || linked.kind !== "table") return axis.labels;
    const myCount = axis.indexcount;
    const match = linked.axes.find((a) => a.labels.length > 0 && a.indexcount === myCount);
    return match?.labels ?? axis.labels;
  }

  function axisLabel(axis: XdfAxis | undefined, idx: number): string {
    if (!axis) return String(idx);
    const labels = resolveLabels(axis);
    const lab = labels.find((l) => l.index === idx);
    if (!lab) return String(idx);
    // Many .xdf files store axis labels as float-formatted integers
    // ("0.00", "1.00"). Strip the trailing zeros so integers render
    // as integers; preserve real fractional labels like "1.50".
    const n = Number(lab.value);
    if (Number.isFinite(n) && Number.isInteger(n)) return n.toString();
    return lab.value;
  }

  type CellRead =
    | { raw: number; eng: number | null; absAddr: number; modified: boolean }
    | { raw: null; eng: null; reason: string; modified: false };

  function readCell(row: number, col: number): CellRead {
    void app.binaryRev; // refresh on byte mutations
    if (!app.binary) return { raw: null, eng: null, reason: "no firmware loaded", modified: false };
    if (!zAxis || !zSpec) return { raw: null, eng: null, reason: "no Z axis", modified: false };
    const e = zAxis.embed;
    const cellAddr = tableCellAddress(e, row, col);
    if (cellAddr === null) {
      return {
        raw: null,
        eng: null,
        reason: `tableCellAddress(row=${row}, col=${col}) → null. embed: ele=${e.elementsizebits}, rows=${e.rowcount}, cols=${e.colcount}, major=${e.majorstridebits}, minor=${e.minorstridebits}, addr=0x${e.address.toString(16)}`,
        modified: false,
      };
    }
    const absAddr = resolveAddress(cellAddr, xdf.header.baseOffset);
    const raw = readScalar(app.binary, { ...zSpec, address: absAddr });
    if (raw === null) {
      return {
        raw: null,
        eng: null,
        reason: `address 0x${absAddr.toString(16).toUpperCase()} past end of firmware (${app.binary.length} bytes)`,
        modified: false,
      };
    }
    const sizeBytes = Math.max(1, Math.ceil(zSpec.sizeBits / 8));
    const modified = isRangeChanged(absAddr, absAddr + sizeBytes);
    return { raw, eng: zToEng ? zToEng(raw) : null, absAddr, modified };
  }

  // First non-OK reason hit while rendering — surfaced once as a panel
  // above the table so the user doesn't have to inspect each "—" cell.
  const firstError = $derived.by(() => {
    if (layout.kind !== "grid") return null;
    for (let r = 0; r < Math.min(2, layout.rows); r++) {
      for (let c = 0; c < Math.min(2, layout.cols); c++) {
        const cell = readCell(r, c);
        if (cell.raw === null) return cell.reason;
      }
    }
    return null;
  });

  let editing = $state<{ row: number; col: number } | null>(null);
  let editValue = $state("");
  let editError = $state<string | null>(null);

  function openEdit(row: number, col: number): void {
    const cell = readCell(row, col);
    if (cell.raw === null) {
      editError = cell.reason;
      return;
    }
    if (displayMode === "hex" && canShowHex) {
      // Pre-fill matches the display: uppercase, no 0x prefix.
      editValue = hex(cell.raw, hexWidth);
    } else {
      const v = zFromEng ? cell.eng : cell.raw;
      editValue = v !== null ? v.toString() : "";
    }
    editing = { row, col };
    editError = null;
  }

  function parseEditValue(): number | null {
    const trimmed = editValue.trim();
    if (trimmed === "") return null;
    // In hex display mode, accept both bare hex (`FF`) and prefixed
    // (`0xFF`) — the pre-fill is bare to match the display, but users
    // pasting in a 0x value shouldn't be rejected.
    if (displayMode === "hex" && canShowHex) {
      const negative = trimmed.startsWith("-");
      const body = trimmed.replace(/^-/, "").replace(/^0x/i, "");
      if (body === "" || !/^[0-9a-fA-F]+$/.test(body)) return null;
      const n = parseInt(body, 16);
      return Number.isFinite(n) ? (negative ? -n : n) : null;
    }
    if (/^-?0x/i.test(trimmed)) {
      const n = parseInt(trimmed.replace(/^-?0x/i, ""), 16);
      return Number.isFinite(n) ? (trimmed.startsWith("-") ? -n : n) : null;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  function commitEdit(ev: Event): void {
    ev.preventDefault();
    if (!editing || !app.binary || !zAxis || !zSpec) return;
    const v = parseEditValue();
    if (v === null) {
      editError = "Enter a number";
      return;
    }
    const cellAddr = tableCellAddress(zAxis.embed, editing.row, editing.col);
    if (cellAddr === null) {
      editError = "Sub-byte cell — edit via RAW view";
      return;
    }
    const absAddr = resolveAddress(cellAddr, xdf.header.baseOffset);
    // Hex mode → user typed the raw value directly. Decimal mode →
    // engineering value, invert if linear, else fall back to raw.
    const raw =
      displayMode === "hex" && canShowHex
        ? v
        : zFromEng
          ? zFromEng(v)
          : v;
    const bytes = encodeScalar(Math.round(raw), zSpec);
    if (!bytes) {
      editError = "Value out of range";
      return;
    }
    writeBytes(absAddr, bytes);
    editing = null;
    editError = null;
  }

  function cancelEdit(): void {
    editing = null;
    editError = null;
  }

  // Svelte action: focus and select the input when it mounts. More
  // reliable than the autofocus attribute, which browsers only honour
  // for the first input on the initial page load.
  function focusOnMount(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }
</script>

<div class="space-y-3">
  <div class="flex items-start justify-between gap-3 text-xs">
    <div class="space-y-1 text-faint">
      {#if zSpec && zAxis}
        <p>
          <span class="font-hex">0x{hex(zSpec.address, 6)}</span>
          <span class="ml-2">{zSpec.sizeBits}-bit {zSpec.signed ? "signed" : "unsigned"} {zSpec.float ? "float" : "int"} {zSpec.lsbfirst ? "LE" : "BE"}</span>
          {#if zAxis.units}<span class="ml-2">[{zAxis.units}]</span>{/if}
        </p>
        <p class="font-hex">MATH: <span class="text-muted">{zAxis.mathEquation}</span></p>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if canShowHex}
        <div class="flex items-center gap-1 rounded border border-divider bg-elevated p-0.5 font-hex">
          <button
            type="button"
            class="rounded px-2 py-0.5 transition"
            class:bg-accent={displayMode === "dec"}
            class:text-black={displayMode === "dec"}
            class:text-muted={displayMode !== "dec"}
            onclick={() => (displayMode = "dec")}
          >dec</button>
          <button
            type="button"
            class="rounded px-2 py-0.5 transition"
            class:bg-accent={displayMode === "hex"}
            class:text-black={displayMode === "hex"}
            class:text-muted={displayMode !== "hex"}
            onclick={() => (displayMode = "hex")}
          >hex</button>
        </div>
      {/if}
      <button
        type="button"
        class="flex items-center gap-1.5 rounded border border-divider bg-elevated px-2 py-0.5 font-hex transition hover:border-accent"
        class:border-accent={heatmap}
        class:text-accent={heatmap}
        class:text-muted={!heatmap}
        onclick={() => (heatmap = !heatmap)}
        title="Colour cells by value (blue = low, red = high)"
      >
        <span
          class="inline-block h-2 w-6 rounded-sm"
          style="background: linear-gradient(90deg, hsl(240,70%,50%), hsl(120,70%,50%), hsl(0,70%,50%));"
        ></span>
        heatmap
      </button>
    </div>
  </div>

  {#if layout.kind === "no-z"}
    <div class="rounded border border-divider bg-elevated p-3 text-sm text-muted">
      Label-only table — no Z (data) axis present.
    </div>
  {:else}
    {#if firstError}
      <div class="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
        Heads up: some cells couldn't be read — {firstError}.
      </div>
    {/if}
    <div class="overflow-auto rounded border border-divider">
      <table class="min-w-full border-collapse text-xs font-hex">
        <thead>
          <tr class="bg-elevated">
            <th class="sticky left-0 z-10 bg-elevated p-1 text-faint">y \ x</th>
            {#each Array.from({ length: layout.cols }, (_, i) => i) as cIdx (cIdx)}
              <th class="px-1.5 py-1 text-faint">{axisLabel(xAxis, cIdx)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each Array.from({ length: layout.rows }, (_, i) => i) as rIdx (rIdx)}
            <tr>
              <th class="sticky left-0 z-10 bg-elevated px-1.5 py-1 text-left text-faint">
                {axisLabel(yAxis, rIdx)}
              </th>
              {#each Array.from({ length: layout.cols }, (_, i) => i) as cIdx (cIdx)}
                {@const cell = readCell(rIdx, cIdx)}
                {@const isEditing = editing?.row === rIdx && editing?.col === cIdx}
                {@const heat = heatColor(cell.eng, cell.raw)}
                <td
                  class="border border-divider px-0 py-0"
                  style={heat && !isEditing ? `background: ${heat};` : ""}
                >
                  {#if isEditing}
                    <form onsubmit={commitEdit} class="flex">
                      <input
                        type="text"
                        bind:value={editValue}
                        use:focusOnMount
                        class="w-24 bg-accent px-1 py-0.5 text-black focus:outline-none"
                        onkeydown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                      />
                    </form>
                  {:else}
                    <button
                      type="button"
                      class="w-full px-1.5 py-0.5 text-right transition hover:bg-elevated disabled:opacity-50"
                      class:text-amber-400={cell.modified}
                      class:font-bold={cell.modified}
                      class:text-foreground={!cell.modified}
                      onclick={() => openEdit(rIdx, cIdx)}
                      ondblclick={() => openEdit(rIdx, cIdx)}
                      disabled={!app.binary}
                      title={cell.modified ? "Modified since load" : undefined}
                    >{formatValue(cell.eng, cell.raw)}</button>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if editError}
      <p class="text-xs text-red-500">{editError}</p>
    {/if}
    <p class="text-xs text-faint">
      Click a cell to edit. Enter writes; Esc cancels.
      {displayMode === "hex" ? "Hex mode bypasses MATH — you're editing the raw bytes." : "Values shown after MATH conversion when the equation is linear; otherwise raw."}
    </p>
  {/if}
</div>
