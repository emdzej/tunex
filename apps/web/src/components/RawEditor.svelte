<script lang="ts">
  import HexView from "./HexView.svelte";
  import InterpretationPanel from "./InterpretationPanel.svelte";
  import BookmarksPanel from "./BookmarksPanel.svelte";
  import JumpToOffset from "./JumpToOffset.svelte";
  import ContentsModeSelect from "./ContentsModeSelect.svelte";
  import ResizeHandle from "./ResizeHandle.svelte";
  import { editor, editPendingBytes } from "../lib/state.svelte";
  import { uiPrefs } from "../lib/ui-prefs.svelte";
  import { hex } from "../lib/format";

  const editing = $derived(editor.start !== null);
  const pendingCount = $derived(editPendingBytes().length);
</script>

<div class="flex h-full">
  <section class="flex min-w-0 flex-1 flex-col">
    <div class="flex items-center gap-4 border-b border-divider bg-surface px-3 py-2">
      <JumpToOffset />
      {#if editing}
        <span
          class="flex items-center gap-2 rounded border border-accent bg-accent/10 px-2 py-1 font-hex text-xs text-accent"
          aria-live="polite"
        >
          <span class="h-2 w-2 animate-pulse rounded-full bg-accent"></span>
          Editing 0x{hex(editor.start ?? 0, 6)} — {pendingCount} byte{pendingCount === 1 ? "" : "s"} typed
          <span class="text-faint">— Enter to accept, Esc to cancel</span>
        </span>
      {/if}
      <span class="flex-1"></span>
      <ContentsModeSelect />
    </div>
    <div class="min-h-0 flex-1">
      <HexView />
    </div>
  </section>

  <ResizeHandle />

  <aside
    class="flex shrink-0 flex-col overflow-auto border-l border-divider"
    style="width: {uiPrefs.sidebarWidth}px;"
  >
    <InterpretationPanel />
    <div class="border-t border-divider">
      <BookmarksPanel />
    </div>
  </aside>
</div>
