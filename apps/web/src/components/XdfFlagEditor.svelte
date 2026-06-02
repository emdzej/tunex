<script lang="ts">
  import type { XdfFlag, XdfDefinition } from "@tunex/xdf-parser";
  import { resolveEmbedded, readFlag, applyFlag } from "@tunex/xdf-parser";
  import { app, writeByte } from "../lib/state.svelte";
  import { hex } from "../lib/format";

  interface Props {
    item: XdfFlag;
    xdf: XdfDefinition;
  }
  let { item, xdf }: Props = $props();

  const spec = $derived(resolveEmbedded(item.embed, xdf.header.baseOffset, xdf.header.defaults));
  const value = $derived(
    app.binary ? readFlag(app.binary, spec.address, item.mask) : null,
  );

  function toggle(): void {
    if (!app.binary || value === null) return;
    const current = app.binary[spec.address];
    writeByte(spec.address, applyFlag(current, item.mask, !value));
  }
</script>

<div class="space-y-3">
  <div class="space-y-1 text-xs text-faint">
    <p>
      <span class="font-hex">0x{hex(spec.address, 6)}</span>
      <span class="ml-2">mask <span class="font-hex">0x{hex(item.mask, 2)}</span></span>
    </p>
  </div>
  <button
    type="button"
    class="flex items-center gap-3 rounded border border-divider bg-elevated p-3 transition hover:border-accent disabled:opacity-50"
    onclick={toggle}
    disabled={!app.binary || value === null}
  >
    <span
      class="inline-flex h-4 w-4 items-center justify-center rounded-sm border"
      class:border-accent={value}
      class:bg-accent={value}
      class:border-divider={!value}
      class:bg-base={!value}
    >
      {#if value}
        <span class="text-xs font-bold text-black">✓</span>
      {/if}
    </span>
    <span class="text-sm text-foreground">
      {value === null ? "—" : value ? "Enabled" : "Disabled"}
    </span>
  </button>
</div>
