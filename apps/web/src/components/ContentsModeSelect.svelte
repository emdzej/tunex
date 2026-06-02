<script lang="ts">
  import { app, type ContentsMode } from "../lib/state.svelte";

  const MODES: { value: ContentsMode; label: string }[] = [
    { value: "ascii", label: "ASCII" },
    { value: "u8", label: "u8" },
    { value: "u16le", label: "u16 LE" },
    { value: "u16be", label: "u16 BE" },
    { value: "i16le", label: "i16 LE" },
    { value: "i16be", label: "i16 BE" },
    { value: "u32le", label: "u32 LE" },
    { value: "i32le", label: "i32 LE" },
  ];

  const barsAvailable = $derived(app.contentsMode !== "ascii");

  // Auto-clear bars when switching back to ASCII so the toggle doesn't
  // get "stuck on" in a mode where it's not meaningful.
  $effect(() => {
    if (!barsAvailable && app.contentsBars) app.contentsBars = false;
  });
</script>

<div class="flex items-center gap-3">
  <label class="flex items-center gap-2 text-xs text-muted">
    Contents
    <select
      bind:value={app.contentsMode}
      class="rounded border border-divider bg-surface px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
    >
      {#each MODES as mode (mode.value)}
        <option value={mode.value}>{mode.label}</option>
      {/each}
    </select>
  </label>

  <label class="flex items-center gap-1.5 text-xs text-muted" class:opacity-40={!barsAvailable}>
    <input
      type="checkbox"
      bind:checked={app.contentsBars}
      disabled={!barsAvailable}
      class="accent-accent"
    />
    Bars
  </label>
</div>
