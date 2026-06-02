<script lang="ts">
  import type { XdfPatch } from "@tunex/xdf-parser";
  import { patchEntryState, type PatchEntryState } from "@tunex/xdf-parser";
  import { app, writeBytes, isRangeChanged } from "../lib/state.svelte";
  import { hex } from "../lib/format";

  interface Props {
    item: XdfPatch;
  }
  let { item }: Props = $props();

  type EntryView = {
    name: string;
    address: number;
    state: PatchEntryState;
    hasBase: boolean;
    patchHex: string;
    baseHex: string;
    modified: boolean;
  };

  function toHex(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
      s += bytes[i].toString(16).toUpperCase().padStart(2, "0");
    }
    return s;
  }

  const entries = $derived.by<EntryView[]>(() => {
    void app.binaryRev; // refresh on byte mutations
    if (!app.binary) {
      return item.entries.map((e) => ({
        name: e.name,
        address: e.address,
        state: "neither" as PatchEntryState,
        hasBase: e.basedata.length > 0,
        patchHex: toHex(e.patchdata),
        baseHex: toHex(e.basedata),
        modified: false,
      }));
    }
    return item.entries.map((e) => ({
      name: e.name,
      address: e.address,
      state: patchEntryState(app.binary!, e.address, e.patchdata, e.basedata),
      hasBase: e.basedata.length > 0,
      patchHex: toHex(e.patchdata),
      baseHex: toHex(e.basedata),
      modified: isRangeChanged(e.address, e.address + e.datasize),
    }));
  });

  // Whole-patch state: applied if every entry applied; virgin if every
  // entry virgin (and has basedata); mixed otherwise.
  const overall = $derived.by(() => {
    if (entries.length === 0) return "neither" as PatchEntryState | "mixed";
    const states = entries.map((e) => e.state);
    if (states.every((s) => s === "applied")) return "applied";
    if (states.every((s) => s === "virgin")) return "virgin";
    return "mixed";
  });

  function applyEntry(idx: number): void {
    const e = item.entries[idx];
    if (!app.binary || !e) return;
    writeBytes(e.address, e.patchdata);
  }

  function revertEntry(idx: number): void {
    const e = item.entries[idx];
    if (!app.binary || !e || e.basedata.length === 0) return;
    writeBytes(e.address, e.basedata);
  }

  function applyAll(): void {
    for (let i = 0; i < item.entries.length; i++) applyEntry(i);
  }

  function revertAll(): void {
    for (let i = 0; i < item.entries.length; i++) revertEntry(i);
  }

  function badgeClass(state: PatchEntryState | "mixed"): string {
    switch (state) {
      case "applied":
        return "bg-emerald-500/10 border-emerald-500/40 text-emerald-300";
      case "virgin":
        return "bg-sky-500/10 border-sky-500/40 text-sky-300";
      case "mixed":
        return "bg-amber-500/10 border-amber-500/40 text-amber-300";
      default:
        return "bg-divider/30 border-divider text-faint";
    }
  }

  function badgeLabel(state: PatchEntryState | "mixed"): string {
    switch (state) {
      case "applied":
        return "applied";
      case "virgin":
        return "virgin";
      case "mixed":
        return "mixed";
      default:
        return "unknown";
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-center gap-2 text-xs">
    <span class="rounded border px-2 py-0.5 font-hex {badgeClass(overall)}">{badgeLabel(overall)}</span>
    <span class="text-faint">{entries.length} entr{entries.length === 1 ? "y" : "ies"}</span>
  </div>

  <div class="flex flex-wrap gap-2">
    <button
      type="button"
      class="rounded bg-accent px-3 py-1.5 text-sm font-medium text-black transition hover:bg-accent-muted hover:text-white disabled:opacity-50"
      onclick={applyAll}
      disabled={!app.binary || overall === "applied"}
    >Apply patch</button>
    <button
      type="button"
      class="rounded border border-divider bg-surface px-3 py-1.5 text-sm text-foreground transition hover:border-accent disabled:opacity-50"
      onclick={revertAll}
      disabled={!app.binary || overall === "virgin" || !entries.some((e) => e.hasBase)}
      title={entries.some((e) => e.hasBase) ? "Restore stock bytes" : "No virgin reference for any entry"}
    >Revert to virgin</button>
  </div>

  <ul class="space-y-2">
    {#each entries as e, idx (idx)}
      <li class="rounded border p-2 text-xs {e.modified ? 'border-amber-500 bg-amber-500/5' : 'border-divider bg-elevated'}">
        <div class="flex items-center gap-2">
          <span class="rounded border px-2 py-0.5 font-hex {badgeClass(e.state)}">{badgeLabel(e.state)}</span>
          {#if e.modified}
            <span
              class="h-1.5 w-1.5 rounded-full bg-amber-400"
              title="Bytes differ from the file as loaded"
            ></span>
          {/if}
          <span class="flex-1 truncate font-medium text-foreground" title={e.name}>{e.name || `entry ${idx + 1}`}</span>
          <span class="font-hex text-faint">0x{hex(e.address, 6)}</span>
        </div>
        <dl class="mt-1 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 font-hex text-faint">
          <dt>patch</dt><dd class="break-all text-foreground">{e.patchHex || "—"}</dd>
          <dt>base</dt><dd class="break-all" class:text-foreground={e.hasBase} class:text-faint={!e.hasBase}>{e.baseHex || "(none)"}</dd>
        </dl>
        <div class="mt-2 flex gap-2">
          <button
            type="button"
            class="rounded bg-accent px-2 py-0.5 text-xs font-medium text-black transition hover:bg-accent-muted hover:text-white disabled:opacity-50"
            onclick={() => applyEntry(idx)}
            disabled={!app.binary || e.state === "applied"}
          >Apply</button>
          <button
            type="button"
            class="rounded border border-divider px-2 py-0.5 text-xs text-foreground transition hover:border-accent disabled:opacity-50"
            onclick={() => revertEntry(idx)}
            disabled={!app.binary || !e.hasBase || e.state === "virgin"}
          >Revert</button>
        </div>
      </li>
    {/each}
  </ul>
</div>
