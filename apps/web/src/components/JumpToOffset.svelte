<script lang="ts">
  import { app, setCursor } from "../lib/state.svelte";
  import { parseOffsetInput } from "../lib/format";

  let raw = $state("");
  let error = $state<string | null>(null);

  function submit(ev: Event): void {
    ev.preventDefault();
    const parsed = parseOffsetInput(raw);
    if (parsed === null) {
      error = "Enter a decimal or hex (0x…) offset";
      return;
    }
    if (!app.binary || parsed >= app.binary.length) {
      error = `Out of range (max 0x${(app.binary?.length ?? 1) - 1})`;
      return;
    }
    error = null;
    setCursor(parsed);
  }
</script>

<form onsubmit={submit} class="flex items-center gap-2">
  <label class="text-xs text-muted" for="goto">Go to</label>
  <input
    id="goto"
    type="text"
    bind:value={raw}
    placeholder="0x… or decimal"
    class="w-32 rounded border border-divider bg-surface px-2 py-1 font-hex text-xs text-foreground focus:border-accent focus:outline-none"
  />
  <button
    type="submit"
    class="rounded bg-elevated px-2 py-1 text-xs text-foreground transition hover:bg-accent hover:text-black"
  >
    Jump
  </button>
  {#if error}
    <span class="text-xs text-red-500">{error}</span>
  {/if}
</form>
