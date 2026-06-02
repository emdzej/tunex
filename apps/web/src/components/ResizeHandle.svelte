<script lang="ts">
  import {
    uiPrefs,
    setSidebarWidth,
    SIDEBAR_MIN,
    SIDEBAR_MAX,
  } from "../lib/ui-prefs.svelte";

  let dragging = $state(false);

  function onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    dragging = true;
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!dragging) return;
    // Width = distance from the viewport's right edge to the pointer.
    // Negative values during fast drags get clamped by setSidebarWidth.
    const width = window.innerWidth - ev.clientX;
    setSidebarWidth(width);
  }

  function onPointerUp(ev: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    const target = ev.currentTarget as HTMLElement;
    if (target.hasPointerCapture(ev.pointerId)) {
      target.releasePointerCapture(ev.pointerId);
    }
  }

  // Arrow-key resize for accessibility — focus the handle, then press
  // Left/Right (or Shift+ for larger steps) to nudge the sidebar.
  function onKeyDown(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? 32 : 8;
    if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      setSidebarWidth(uiPrefs.sidebarWidth + step);
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      setSidebarWidth(uiPrefs.sidebarWidth - step);
    }
  }
</script>

<!-- The resize handle is intentionally interactive — role="separator"
     with aria-orientation makes it a recognised resize target, and the
     div tag is intentional (no semantic native element fits). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-valuenow={uiPrefs.sidebarWidth}
  aria-valuemin={SIDEBAR_MIN}
  aria-valuemax={SIDEBAR_MAX}
  aria-label="Resize sidebar"
  tabindex="0"
  class="group relative w-1 shrink-0 cursor-col-resize select-none bg-divider transition hover:bg-accent"
  class:bg-accent={dragging}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeyDown}
></div>
