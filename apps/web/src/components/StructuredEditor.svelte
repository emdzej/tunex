<script lang="ts">
  import { app } from "../lib/state.svelte";

  let error = $state<string | null>(null);

  async function pickXdf(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    error = null;
    try {
      const text = await file.text();
      app.xdfFilename = file.name;
      // Milestone 2 wires the actual parser. For now just stash the
      // filename so the UI confirms the pick worked.
      void text;
      error = "Structured editor lands in Milestone 2 — file recognised, parser not yet wired.";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="flex h-full">
  <aside class="w-72 shrink-0 border-r border-divider bg-surface p-3 text-sm">
    <h2 class="text-sm font-semibold text-foreground">XDF definition</h2>
    {#if app.xdfFilename}
      <p class="mt-2 truncate text-xs text-muted" title={app.xdfFilename}>
        {app.xdfFilename}
      </p>
    {:else}
      <p class="mt-2 text-xs text-faint">
        Pick a TunerPro .xdf file describing this firmware.
      </p>
    {/if}

    <label
      class="mt-3 inline-block cursor-pointer rounded border border-divider bg-elevated px-2 py-1 text-xs text-foreground transition hover:border-accent"
    >
      Choose .xdf…
      <input type="file" accept=".xdf,.xml" class="hidden" onchange={pickXdf} />
    </label>
  </aside>

  <section class="flex min-w-0 flex-1 items-center justify-center p-8 text-center">
    {#if error}
      <p class="max-w-md text-sm text-muted">{error}</p>
    {:else if !app.xdfFilename}
      <p class="max-w-md text-sm text-faint">
        Load an .xdf definition on the left to start editing named parameters.
      </p>
    {:else}
      <p class="max-w-md text-sm text-faint">
        Parser comes online in Milestone 2.
      </p>
    {/if}
  </section>
</div>
