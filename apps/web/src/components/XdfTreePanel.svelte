<script lang="ts">
  import type { XdfDefinition, XdfItem } from "@tunex/xdf-parser";
  import { app, selectXdfItem } from "../lib/state.svelte";
  import { hex } from "../lib/format";

  interface Props {
    xdf: XdfDefinition;
  }
  let { xdf }: Props = $props();

  let search = $state("");
  let collapsed = $state<Record<number, boolean>>({});

  // Special index used for items that don't link to any category in
  // the header — keeps them visible instead of silently hiding.
  const UNCATEGORISED = -1;

  // Build a [categoryIndex → items] map. Items can appear under more
  // than one category (CATEGORYMEM siblings) — that mirrors TunerPro's
  // behaviour where one item shows in multiple lists.
  const grouped = $derived.by(() => {
    const map = new Map<number, XdfItem[]>();
    const filter = search.trim().toLowerCase();
    const matches = (item: XdfItem) =>
      filter === "" || item.title.toLowerCase().includes(filter);

    for (const item of xdf.items) {
      if (!matches(item)) continue;
      const cats = item.categoryIndices.length > 0 ? item.categoryIndices : [UNCATEGORISED];
      for (const c of cats) {
        const list = map.get(c);
        if (list) list.push(item);
        else map.set(c, [item]);
      }
    }
    return map;
  });

  const categories = $derived.by(() => {
    const list = xdf.header.categories.slice().sort((a, b) => a.index - b.index);
    if (grouped.has(UNCATEGORISED)) {
      list.push({ index: UNCATEGORISED, name: "Uncategorised" });
    }
    return list;
  });

  function kindLabel(item: XdfItem): string {
    switch (item.kind) {
      case "constant":
        return "C";
      case "flag":
        return "F";
      case "patch":
        return "P";
      case "table":
        return "T";
    }
  }

  function kindColor(item: XdfItem): string {
    switch (item.kind) {
      case "constant":
        return "text-sky-400";
      case "flag":
        return "text-emerald-400";
      case "patch":
        return "text-rose-400";
      case "table":
        return "text-purple-400";
    }
  }

  function toggle(idx: number): void {
    collapsed[idx] = !collapsed[idx];
  }
</script>

<div class="flex h-full flex-col">
  <div class="border-b border-divider bg-surface p-2">
    <input
      type="search"
      placeholder="Filter items…"
      bind:value={search}
      class="w-full rounded border border-divider bg-base px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
    />
  </div>

  <div class="min-h-0 flex-1 overflow-auto p-2 text-xs">
    {#each categories as cat (cat.index)}
      {@const items = grouped.get(cat.index) ?? []}
      {#if items.length > 0 || search.trim() === ""}
        <div class="mb-1">
          <button
            type="button"
            class="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-foreground transition hover:bg-elevated"
            onclick={() => toggle(cat.index)}
          >
            <span class="text-faint">{collapsed[cat.index] ? "▸" : "▾"}</span>
            <span class="flex-1 truncate font-medium" title={cat.name}>{cat.name}</span>
            <span class="text-faint">{items.length}</span>
          </button>
          {#if !collapsed[cat.index]}
            <ul class="ml-3 mt-0.5 space-y-0.5">
              {#each items as item, itemIdx (`${item.uniqueid}:${itemIdx}`)}
                {@const selected = app.selectedItemId === item.uniqueid}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition"
                    class:bg-accent={selected}
                    class:text-black={selected}
                    class:text-foreground={!selected}
                    class:hover:bg-elevated={!selected}
                    onclick={() => selectXdfItem(item)}
                    title={item.title}
                  >
                    <span class="font-hex {selected ? '' : kindColor(item)}">{kindLabel(item)}</span>
                    <span class="flex-1 truncate">{item.title || `(0x${hex(item.uniqueid, 4)})`}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    {/each}

    {#if categories.length === 0}
      <p class="text-faint">No items in this .xdf.</p>
    {/if}
  </div>
</div>
