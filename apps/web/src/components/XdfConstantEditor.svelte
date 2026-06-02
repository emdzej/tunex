<script lang="ts">
  import type { XdfConstant, XdfDefinition } from "@tunex/xdf-parser";
  import {
    resolveEmbedded,
    readScalar,
    encodeScalar,
    compileMath,
    invertLinear,
  } from "@tunex/xdf-parser";
  import { app, writeBytes } from "../lib/state.svelte";
  import { hex } from "../lib/format";

  interface Props {
    item: XdfConstant;
    xdf: XdfDefinition;
  }
  let { item, xdf }: Props = $props();

  const spec = $derived(resolveEmbedded(item.embed, xdf.header.baseOffset, xdf.header.defaults));
  const toEng = $derived.by(() => {
    try {
      return compileMath(item.mathEquation);
    } catch {
      return null;
    }
  });
  const fromEng = $derived.by(() => {
    try {
      return invertLinear(item.mathEquation);
    } catch {
      return null;
    }
  });

  const rawValue = $derived(app.binary ? readScalar(app.binary, spec) : null);
  const engValue = $derived(
    rawValue !== null && toEng ? toEng(rawValue) : null,
  );

  let inputValue = $state("");
  let editing = $state(false);
  let error = $state<string | null>(null);

  // Display mode: decimal (default — uses MATH-converted engineering
  // value) or hex (raw bytes, only meaningful for non-float types).
  // Toggle is a per-constant local state; users move between
  // constants frequently enough that persisting feels noisy.
  let displayMode = $state<"dec" | "hex">("dec");
  const canShowHex = $derived(!spec.float);
  const hexWidth = $derived(Math.max(2, Math.ceil(spec.sizeBits / 4)));
  // TunerPro default: decimalpl = 2 (XDFCONSTANT only emits the tag
  // when ≠ 2 — confirmed via the DEFAULTS serialiser in Ghidra).
  const decimalpl = $derived(item.decimalpl ?? 2);

  function formatEng(v: number): string {
    // Integer values render without decimals — `42` not `42.00`. Float
    // types keep the formatting so users see precision differences.
    if (Number.isInteger(v) && !spec.float) return v.toString();
    return v.toFixed(decimalpl);
  }

  function startEdit(): void {
    editing = true;
    error = null;
    if (displayMode === "hex" && canShowHex && rawValue !== null) {
      inputValue = `0x${hex(rawValue, hexWidth)}`;
    } else if (fromEng && engValue !== null) {
      inputValue = formatEng(engValue);
    } else {
      inputValue = rawValue !== null ? rawValue.toString() : "";
    }
  }

  function parseInput(): number | null {
    const trimmed = inputValue.trim();
    if (trimmed === "") return null;
    if (/^-?0x/i.test(trimmed)) {
      const n = parseInt(trimmed.replace(/^-?0x/i, ""), 16);
      return Number.isFinite(n) ? (trimmed.startsWith("-") ? -n : n) : null;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  function commit(ev: Event): void {
    ev.preventDefault();
    if (!app.binary) return;
    const v = parseInput();
    if (v === null) {
      error = "Enter a numeric value";
      return;
    }
    let raw: number;
    if (displayMode === "hex" && canShowHex) {
      // Hex mode: typed value is the raw bytes directly.
      raw = v;
    } else if (fromEng) {
      // Engineering value with linear MATH — range check on eng side.
      if (item.rangelow !== undefined && v < item.rangelow) {
        error = `Below range (min ${item.rangelow})`;
        return;
      }
      if (item.rangehigh !== undefined && v > item.rangehigh) {
        error = `Above range (max ${item.rangehigh})`;
        return;
      }
      raw = fromEng(v);
    } else {
      // Non-linear MATH — user types the raw value (we labelled the
      // field accordingly).
      raw = v;
    }
    const bytes = encodeScalar(spec.float ? raw : Math.round(raw), spec);
    if (!bytes) {
      error = "Encoded value out of range for this datatype";
      return;
    }
    writeBytes(spec.address, bytes);
    editing = false;
    error = null;
  }

  function cancel(): void {
    editing = false;
    error = null;
  }
</script>

<div class="space-y-3">
  <div class="space-y-1 text-xs text-faint">
    <p>
      <span class="font-hex">0x{hex(spec.address, 6)}</span>
      <span class="ml-2">{spec.sizeBits}-bit {spec.signed ? "signed" : "unsigned"} {spec.float ? "float" : "int"} {spec.lsbfirst ? "LE" : "BE"}</span>
    </p>
    <p class="font-hex text-foreground">MATH: <span class="text-muted">{item.mathEquation}</span></p>
    {#if !fromEng && toEng}
      <p class="text-amber-400">Non-linear conversion — write-back disabled (use Raw entry).</p>
    {/if}
  </div>

  <div class="grid grid-cols-2 gap-3">
    <div class="space-y-1 rounded border border-divider bg-elevated p-2">
      <span class="text-xs text-faint">Engineering</span>
      <div class="font-hex text-lg text-foreground">
        {engValue !== null ? formatEng(engValue) : "—"}
        {#if item.units}<span class="ml-1 text-xs text-muted">{item.units}</span>{/if}
      </div>
      {#if item.rangelow !== undefined || item.rangehigh !== undefined}
        <div class="text-xs text-faint">
          range {item.rangelow ?? "?"}…{item.rangehigh ?? "?"}{#if item.units} {item.units}{/if}
        </div>
      {/if}
    </div>
    <div class="space-y-1 rounded border border-divider bg-elevated p-2">
      <span class="text-xs text-faint">Raw</span>
      <div class="font-hex text-lg text-foreground">
        {rawValue !== null ? rawValue : "—"}
        {#if rawValue !== null}
          <span class="ml-1 text-xs text-muted">0x{hex(rawValue, hexWidth)}</span>
        {/if}
      </div>
    </div>
  </div>

  {#if canShowHex}
    <div class="flex items-center gap-2 text-xs text-faint">
      <span>Edit as</span>
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
      {#if displayMode === "hex"}
        <span class="text-muted">— bypasses MATH; edits raw bytes</span>
      {/if}
    </div>
  {/if}

  {#if !editing}
    <button
      type="button"
      class="rounded bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:bg-accent-muted hover:text-white disabled:opacity-50"
      onclick={startEdit}
      disabled={!app.binary}
    >Edit</button>
  {:else}
    <form onsubmit={commit} class="space-y-2">
      <label class="flex flex-col gap-1 text-xs text-faint">
        {displayMode === "hex" && canShowHex
          ? "Raw bytes (hex)"
          : fromEng
            ? `Engineering value${item.units ? ` (${item.units})` : ""}`
            : "Raw value"}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={inputValue}
          class="rounded border border-divider bg-surface px-2 py-1 font-hex text-sm text-foreground focus:border-accent focus:outline-none"
          autofocus
        />
      </label>
      {#if error}
        <p class="text-xs text-red-500">{error}</p>
      {/if}
      <div class="flex gap-2">
        <button
          type="submit"
          class="rounded bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:bg-accent-muted hover:text-white"
        >Write</button>
        <button
          type="button"
          class="rounded px-3 py-1.5 text-sm text-muted transition hover:text-foreground"
          onclick={cancel}
        >Cancel</button>
      </div>
    </form>
  {/if}
</div>
