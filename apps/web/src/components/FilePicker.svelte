<script lang="ts">
  import { loadBinary, app } from "../lib/state.svelte";

  let dragOver = $state(false);
  let error = $state<string | null>(null);

  async function ingest(file: File): Promise<void> {
    error = null;
    try {
      const buf = await file.arrayBuffer();
      loadBinary(new Uint8Array(buf), file.name);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void ingest(file);
  }

  function onDrop(ev: DragEvent): void {
    ev.preventDefault();
    dragOver = false;
    const file = ev.dataTransfer?.files?.[0];
    if (file) void ingest(file);
  }
</script>

<div class="flex h-full items-center justify-center p-8">
  <div
    class="flex w-full max-w-xl flex-col items-center gap-4 rounded-lg border-2 border-dashed p-12 transition"
    class:border-accent={dragOver}
    class:bg-elevated={dragOver}
    class:border-divider={!dragOver}
    class:bg-surface={!dragOver}
    ondragover={(e) => {
      e.preventDefault();
      dragOver = true;
    }}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
    role="region"
    aria-label="Drop firmware file here"
  >
    <div class="text-center">
      <h1 class="text-2xl font-semibold text-foreground">Load ECU firmware</h1>
      <p class="mt-2 text-sm text-muted">
        Drop a binary file here, or pick one to start editing.
      </p>
      <p class="mt-1 text-xs text-faint">
        Everything stays in your browser — no upload, no server.
      </p>
    </div>

    <label
      class="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-accent-muted"
    >
      Choose file…
      <input type="file" class="hidden" onchange={onPick} />
    </label>

    {#if error}
      <p class="text-sm text-red-500">{error}</p>
    {/if}

    {#if app.filename}
      <p class="text-xs text-faint">Last loaded: <span class="font-hex">{app.filename}</span></p>
    {/if}
  </div>
</div>
