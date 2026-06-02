<script lang="ts">
  import { app, loadXdf, findXdfItem } from "../lib/state.svelte";
  import XdfTreePanel from "./XdfTreePanel.svelte";
  import XdfItemEditor from "./XdfItemEditor.svelte";

  let importing = $state(false);

  const selected = $derived(findXdfItem(app.selectedItemId));

  async function pickXdf(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importing = true;
    try {
      const text = await file.text();
      loadXdf(text, file.name);
    } finally {
      importing = false;
      // Reset the input so picking the same file again re-fires onchange.
      input.value = "";
    }
  }

  function unload(): void {
    app.xdf = null;
    app.xdfFilename = "";
    app.xdfError = null;
    app.selectedItemId = null;
    app.highlightRange = null;
  }
</script>

<div class="flex h-full flex-col">
  <header class="flex items-center gap-3 border-b border-divider bg-surface px-3 py-2 text-sm">
    {#if app.xdf}
      <span class="font-medium text-foreground">{app.xdf.header.deftitle || "XDF"}</span>
      <span class="font-hex text-xs text-faint">{app.xdfFilename}</span>
      <span class="text-xs text-faint">v{app.xdf.header.fileversion}</span>
      <span class="text-xs text-faint">— {app.xdf.items.length} items</span>
      <span class="flex-1"></span>
      <button
        class="rounded border border-divider bg-surface px-2 py-0.5 text-xs text-muted transition hover:border-accent"
        onclick={unload}
      >Close</button>
    {:else}
      <span class="text-muted">No XDF loaded</span>
      <span class="flex-1"></span>
    {/if}
    <label
      class="cursor-pointer rounded bg-accent px-2 py-1 text-xs font-medium text-black transition hover:bg-accent-muted hover:text-white"
    >
      {app.xdf ? "Replace .xdf…" : "Open .xdf…"}
      <input type="file" accept=".xdf,.xml" class="hidden" onchange={pickXdf} disabled={importing} />
    </label>
  </header>

  {#if app.xdfError}
    <div class="border-b border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
      Failed to parse <span class="font-hex">{app.xdfFilename}</span>: {app.xdfError}
    </div>
  {/if}

  {#if !app.xdf}
    <div class="flex flex-1 items-center justify-center p-8 text-center">
      <div class="max-w-md space-y-2">
        <p class="text-sm text-muted">
          Load a TunerPro <span class="font-hex">.xdf</span> definition to browse the
          firmware's named constants, flags, patches and tables.
        </p>
        <p class="text-xs text-faint">
          The .xdf file is independent of the firmware — the same definition usually
          covers multiple binary versions of the same ECU.
        </p>
      </div>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1">
      <aside class="w-72 shrink-0 border-r border-divider bg-base">
        <XdfTreePanel xdf={app.xdf} />
      </aside>
      <section class="min-w-0 flex-1 overflow-auto p-4">
        {#if selected}
          <XdfItemEditor item={selected} xdf={app.xdf} />
        {:else}
          <p class="text-sm text-faint">Select an item on the left.</p>
        {/if}
      </section>
    </div>
  {/if}
</div>
