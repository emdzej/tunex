<script lang="ts">
  import type { XdfItem, XdfDefinition } from "@tunex/xdf-parser";
  import XdfConstantEditor from "./XdfConstantEditor.svelte";
  import XdfFlagEditor from "./XdfFlagEditor.svelte";
  import XdfPatchEditor from "./XdfPatchEditor.svelte";
  import XdfTableEditor from "./XdfTableEditor.svelte";
  import { app, setCursor } from "../lib/state.svelte";
  import { hex } from "../lib/format";

  interface Props {
    item: XdfItem;
    xdf: XdfDefinition;
  }
  let { item, xdf }: Props = $props();

  function jumpToBytes(): void {
    if (!app.highlightRange) return;
    setCursor(app.highlightRange.start);
    app.view = "raw";
  }
</script>

<header class="space-y-1">
  <div class="flex items-baseline gap-3">
    <h2 class="flex-1 text-lg font-semibold text-foreground">{item.title || "(untitled)"}</h2>
    {#if app.highlightRange && app.binary}
      <button
        type="button"
        class="rounded border border-divider px-2 py-0.5 font-hex text-xs text-muted transition hover:border-accent hover:text-foreground"
        onclick={jumpToBytes}
        title="Switch to RAW and jump cursor to this item"
      >Jump 0x{hex(app.highlightRange.start, 6)} →</button>
    {/if}
  </div>
  {#if item.description}
    <p class="whitespace-pre-line text-sm text-muted">{item.description}</p>
  {/if}
</header>

<div class="mt-4">
  {#if item.kind === "constant"}
    <XdfConstantEditor {item} {xdf} />
  {:else if item.kind === "flag"}
    <XdfFlagEditor {item} {xdf} />
  {:else if item.kind === "patch"}
    <XdfPatchEditor {item} />
  {:else if item.kind === "table"}
    <XdfTableEditor {item} {xdf} />
  {/if}
</div>
