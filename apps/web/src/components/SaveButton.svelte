<script lang="ts">
  import { app } from "../lib/state.svelte";

  function save(): void {
    if (!app.binary) return;
    // Copy into a fresh buffer for the Blob — using the live Uint8Array
    // can fail in some browsers if the underlying buffer is later detached.
    const blob = new Blob([app.binary.slice()], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName(app.filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    app.dirty = false;
  }

  function downloadName(name: string): string {
    if (!name) return "firmware.bin";
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return `${name}-tunex`;
    return `${name.slice(0, dot)}-tunex${name.slice(dot)}`;
  }
</script>

<button
  class="rounded border border-divider bg-surface px-2 py-0.5 text-xs transition hover:border-accent hover:bg-elevated"
  class:text-accent={app.dirty}
  class:text-muted={!app.dirty}
  onclick={save}
  title={app.dirty ? "Save modified binary" : "Save (no changes)"}
>
  Save{app.dirty ? " *" : ""}
</button>
