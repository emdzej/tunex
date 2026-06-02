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
  import { app, writeBytes } from "../lib/state.svelte";
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

  // Display mode toggle. Hex only makes sense for integer cells —
  // floats always render as decimal.
  let displayMode = $state<"dec" | "hex">("dec");
  const canShowHex = $derived(zSpec ? !zSpec.float : false);
  const hexWidth = $derived(zSpec ? Math.max(2, Math.ceil(zSpec.sizeBits / 4)) : 2);

  function formatValue(eng: number | null, raw: number | null): string {
    if (displayMode === "hex" && canShowHex && raw !== null) {
      // Hex view shows the underlying raw bytes; MATH would lose
      // meaning when re-interpreted as hex.
      return `0x${hex(raw & ((1 << zSpec!.sizeBits) - 1 || 0xffffffff), hexWidth)}`;
    }
    const v = eng !== null ? eng : raw;
    if (v === null) return "—";
    // Integer values render without decimals — `255` not `255.00`.
    // Floats always keep the precision so users can still see e.g.
    // 1.0 vs 1.0000001.
    if (Number.isInteger(v) && !zSpec?.float) return v.toString();
    return v.toFixed(decimalpl);
  }

  function axisLabel(axis: XdfAxis | undefined, idx: number): string {
    if (!axis) return String(idx);
    const lab = axis.labels.find((l) => l.index === idx);
    if (!lab) return String(idx);
    // Many .xdf files store axis labels as float-formatted integers
    // ("0.00", "1.00"). Strip the trailing zeros so integers render
    // as integers; preserve real fractional labels like "1.50".
    const n = Number(lab.value);
    if (Number.isFinite(n) && Number.isInteger(n)) return n.toString();
    return lab.value;
  }

  type CellRead =
    | { raw: number; eng: number | null; absAddr: number }
    | { raw: null; eng: null; reason: string };

  function readCell(row: number, col: number): CellRead {
    if (!app.binary) return { raw: null, eng: null, reason: "no firmware loaded" };
    if (!zAxis || !zSpec) return { raw: null, eng: null, reason: "no Z axis" };
    const cellAddr = tableCellAddress(zAxis.embed, row, col);
    if (cellAddr === null) {
      return { raw: null, eng: null, reason: "cell not byte-aligned" };
    }
    const absAddr = resolveAddress(cellAddr, xdf.header.baseOffset);
    const raw = readScalar(app.binary, { ...zSpec, address: absAddr });
    if (raw === null) {
      return {
        raw: null,
        eng: null,
        reason: `address 0x${absAddr.toString(16).toUpperCase()} past end of firmware (${app.binary.length} bytes)`,
      };
    }
    return { raw, eng: zToEng ? zToEng(raw) : null, absAddr };
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
      editValue = `0x${hex(cell.raw, hexWidth)}`;
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
                <td class="border border-divider px-0 py-0">
                  {#if isEditing}
                    <form onsubmit={commitEdit} class="flex">
                      <!-- svelte-ignore a11y_autofocus -->
                      <input
                        type="text"
                        bind:value={editValue}
                        autofocus
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
                      class="w-full px-1.5 py-0.5 text-right text-foreground transition hover:bg-elevated disabled:opacity-50"
                      onclick={() => openEdit(rIdx, cIdx)}
                      disabled={!app.binary}
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
