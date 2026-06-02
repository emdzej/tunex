<script lang="ts">
  import {
    app,
    setCursor,
    editor,
    editPendingBytes,
    editPendingPartial,
    startEdit,
    commitEdit,
    cancelEdit,
    appendEditChar,
    popEditChar,
    isByteChanged,
  } from "../lib/state.svelte";
  import { asciiChar, isPrintable, readNumeric, type NumericType } from "../lib/interpret";
  import { hex } from "../lib/format";

  const BYTES_PER_ROW = 16;
  const ROW_HEIGHT = 20;

  // Per-mode metadata. `cellChars` is the character width reserved for
  // each numeric cell so columns line up across rows. Used both for the
  // text rendering and to size the equivalent bar cells.
  type ContentsModeMeta = {
    type: NumericType | "ascii";
    cellChars: number;
    bytesPerCell: number;
    signed: boolean;
    /** Max absolute value, used to scale bars. */
    maxAbs: number;
  };
  const CONTENTS_META: Record<typeof app.contentsMode, ContentsModeMeta> = {
    ascii: { type: "ascii", cellChars: 1, bytesPerCell: 1, signed: false, maxAbs: 1 },
    u8: { type: "u8", cellChars: 3, bytesPerCell: 1, signed: false, maxAbs: 0xff },
    u16le: { type: "u16le", cellChars: 5, bytesPerCell: 2, signed: false, maxAbs: 0xffff },
    u16be: { type: "u16be", cellChars: 5, bytesPerCell: 2, signed: false, maxAbs: 0xffff },
    i16le: { type: "i16le", cellChars: 6, bytesPerCell: 2, signed: true, maxAbs: 0x8000 },
    i16be: { type: "i16be", cellChars: 6, bytesPerCell: 2, signed: true, maxAbs: 0x8000 },
    u32le: { type: "u32le", cellChars: 10, bytesPerCell: 4, signed: false, maxAbs: 0xffffffff },
    i32le: { type: "i32le", cellChars: 11, bytesPerCell: 4, signed: true, maxAbs: 0x80000000 },
  };

  let scrollEl = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewportH = $state(600);

  const totalRows = $derived(
    app.binary ? Math.ceil(app.binary.length / BYTES_PER_ROW) : 0,
  );
  const totalHeight = $derived(totalRows * ROW_HEIGHT);

  const overscan = 4;
  const firstVisibleRow = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan));
  const visibleRowCount = $derived(
    Math.min(totalRows - firstVisibleRow, Math.ceil(viewportH / ROW_HEIGHT) + 2 * overscan),
  );

  function onScroll(): void {
    if (scrollEl) scrollTop = scrollEl.scrollTop;
  }

  $effect(() => {
    if (!scrollEl) return;
    const ro = new ResizeObserver(() => {
      viewportH = scrollEl?.clientHeight ?? 600;
    });
    ro.observe(scrollEl);
    viewportH = scrollEl.clientHeight;
    return () => ro.disconnect();
  });

  // Scroll cursor into view when it changes (jump-to-offset, keyboard nav).
  $effect(() => {
    if (!scrollEl) return;
    const cursor = app.cursor;
    const row = Math.floor(cursor / BYTES_PER_ROW);
    const top = row * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < scrollEl.scrollTop || bottom > scrollEl.scrollTop + scrollEl.clientHeight) {
      scrollEl.scrollTop = Math.max(0, top - scrollEl.clientHeight / 2);
    }
  });

  function isFormElement(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (!app.binary) return;
    // Don't intercept keys destined for form inputs (jump-to-offset, etc).
    if (isFormElement(ev.target)) return;

    // 'g' shortcut → focus the jump-to-offset input. Only when not in
    // edit mode (where every keystroke is reserved for hex input) and
    // not paired with a modifier (don't shadow Cmd+G / Ctrl+G).
    if (
      ev.key === "g" &&
      editor.start === null &&
      !ev.metaKey &&
      !ev.ctrlKey &&
      !ev.altKey
    ) {
      const goto = document.getElementById("goto") as HTMLInputElement | null;
      if (goto) {
        ev.preventDefault();
        goto.focus();
        goto.select();
        return;
      }
    }

    // While editing, hex keys accumulate; Enter commits, Esc cancels.
    if (editor.start !== null) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitEdit();
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancelEdit();
        return;
      }
      if (ev.key === "Backspace") {
        ev.preventDefault();
        popEditChar();
        return;
      }
      if (ev.key === " " || /^[0-9a-fA-F]$/.test(ev.key)) {
        ev.preventDefault();
        appendEditChar(ev.key);
        return;
      }
      // Swallow nav keys so the cursor doesn't drift mid-edit.
      ev.preventDefault();
      return;
    }

    let next = app.cursor;
    const last = app.binary.length - 1;
    switch (ev.key) {
      case "ArrowLeft":
        next -= 1;
        break;
      case "ArrowRight":
        next += 1;
        break;
      case "ArrowUp":
        next -= BYTES_PER_ROW;
        break;
      case "ArrowDown":
        next += BYTES_PER_ROW;
        break;
      case "PageUp":
        next -= BYTES_PER_ROW * 16;
        break;
      case "PageDown":
        next += BYTES_PER_ROW * 16;
        break;
      case "Home":
        next = ev.ctrlKey || ev.metaKey ? 0 : Math.floor(app.cursor / BYTES_PER_ROW) * BYTES_PER_ROW;
        break;
      case "End":
        next = ev.ctrlKey || ev.metaKey
          ? last
          : Math.min(last, Math.floor(app.cursor / BYTES_PER_ROW) * BYTES_PER_ROW + BYTES_PER_ROW - 1);
        break;
      default:
        return;
    }
    ev.preventDefault();
    setCursor(next);
  }

  // Edit overlay lookup. Returns the override info for a byte offset:
  // - committed pending byte (a typed pair) — `display` is "XX"
  // - in-progress nibble — `display` is "X_"
  // - none — `display` is null and `editing` is false.
  type EditInfo = { editing: boolean; display: string | null; finalized: boolean };
  function editInfo(off: number): EditInfo {
    if (editor.start === null) return { editing: false, display: null, finalized: false };
    const idx = off - editor.start;
    if (idx < 0) return { editing: false, display: null, finalized: false };
    const bytes = editPendingBytes();
    if (idx < bytes.length) {
      return { editing: true, display: hex(bytes[idx], 2), finalized: true };
    }
    const partial = editPendingPartial();
    if (idx === bytes.length && partial !== null) {
      return { editing: true, display: `${partial}_`, finalized: false };
    }
    return { editing: false, display: null, finalized: false };
  }

  /** Effective byte (with pending edits applied) for contents-column rendering. */
  function effectiveByte(off: number): number {
    if (!app.binary) return 0;
    if (editor.start !== null) {
      const idx = off - editor.start;
      if (idx >= 0) {
        const bytes = editPendingBytes();
        if (idx < bytes.length) return bytes[idx];
      }
    }
    return app.binary[off];
  }

  // Materialise a row-local buffer (16 bytes) so DataView reads see the
  // pending edit overlay. Cheap — one tiny allocation per visible row.
  function rowBuffer(rowStart: number): { buf: Uint8Array; len: number } {
    const len = app.binary
      ? Math.max(0, Math.min(BYTES_PER_ROW, app.binary.length - rowStart))
      : 0;
    const buf = new Uint8Array(BYTES_PER_ROW);
    if (!app.binary) return { buf, len };
    for (let i = 0; i < len; i++) buf[i] = app.binary[rowStart + i];
    if (editor.start !== null) {
      const bytes = editPendingBytes();
      for (let j = 0; j < bytes.length; j++) {
        const off = editor.start + j;
        if (off >= rowStart && off < rowStart + BYTES_PER_ROW) {
          buf[off - rowStart] = bytes[j];
        }
      }
    }
    return { buf, len };
  }

  /** Per-cell text-mode rendering. Each cell knows its byte range so
   *  the renderer can wrap it in a click target that sets the cursor. */
  type TextCell = { offset: number; bytesPerCell: number; text: string; fits: boolean };
  function rowContentsCells(rowStart: number, mode: typeof app.contentsMode): TextCell[] {
    const meta = CONTENTS_META[mode];
    const { buf, len } = rowBuffer(rowStart);
    const cells: TextCell[] = [];
    if (mode === "ascii") {
      for (let i = 0; i < BYTES_PER_ROW; i++) {
        const fits = i < len;
        cells.push({
          offset: rowStart + i,
          bytesPerCell: 1,
          text: fits ? asciiChar(buf[i]) : " ",
          fits,
        });
      }
      return cells;
    }
    for (let i = 0; i < BYTES_PER_ROW; i += meta.bytesPerCell) {
      const fits = i + meta.bytesPerCell <= len;
      if (!fits) {
        cells.push({
          offset: rowStart + i,
          bytesPerCell: meta.bytesPerCell,
          text: " ".repeat(meta.cellChars),
          fits: false,
        });
        continue;
      }
      const v = readNumeric(buf, i, meta.type as NumericType);
      cells.push({
        offset: rowStart + i,
        bytesPerCell: meta.bytesPerCell,
        text: (v === null ? "" : v.toString()).padStart(meta.cellChars, " "),
        fits: true,
      });
    }
    return cells;
  }

  // Bars-mode rendering. Returns an array of { value, fits, pct,
  // signed, offset, bytesPerCell } per cell for the row. pct is in
  // -100..100 (negative for signed below zero); offset + bytesPerCell
  // let the renderer wrap each bar in a click target that sets the
  // cursor to the matching byte range.
  type BarCell = {
    fits: boolean;
    value: number;
    pct: number;
    signed: boolean;
    offset: number;
    bytesPerCell: number;
  };
  function rowBars(rowStart: number, mode: typeof app.contentsMode): BarCell[] {
    const meta = CONTENTS_META[mode];
    const { buf, len } = rowBuffer(rowStart);
    const cells: BarCell[] = [];
    for (let i = 0; i < BYTES_PER_ROW; i += meta.bytesPerCell) {
      const offset = rowStart + i;
      if (i + meta.bytesPerCell > len) {
        cells.push({
          fits: false,
          value: 0,
          pct: 0,
          signed: meta.signed,
          offset,
          bytesPerCell: meta.bytesPerCell,
        });
        continue;
      }
      const v = readNumeric(buf, i, meta.type as NumericType) ?? 0;
      const pct = (v / meta.maxAbs) * 100;
      cells.push({
        fits: true,
        value: v,
        pct: Math.max(-100, Math.min(100, pct)),
        signed: meta.signed,
        offset,
        bytesPerCell: meta.bytesPerCell,
      });
    }
    return cells;
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if app.binary}
  {@const bytes = app.binary}
  {@const contentsMeta = CONTENTS_META[app.contentsMode]}
  {@const useBars = app.contentsBars && app.contentsMode !== "ascii"}
  <div
    bind:this={scrollEl}
    onscroll={onScroll}
    class="relative h-full overflow-auto bg-base px-3 py-2 font-hex text-xs leading-5"
    tabindex="0"
    role="grid"
    aria-label="Hex view"
  >
    <div style="height: {totalHeight}px; position: relative;">
      <div
        style="position: absolute; top: {firstVisibleRow * ROW_HEIGHT}px; left: 0; right: 0;"
      >
        {#each Array.from({ length: Math.max(0, visibleRowCount) }, (_, i) => firstVisibleRow + i) as rowIdx (rowIdx)}
          {@const rowStart = rowIdx * BYTES_PER_ROW}
          {@const rowEnd = Math.min(rowStart + BYTES_PER_ROW, bytes.length)}
          {@const cursorInRow = app.cursor >= rowStart && app.cursor < rowEnd}
          <div
            class="flex whitespace-pre items-center"
            style="height: {ROW_HEIGHT}px;"
            class:bg-elevated={cursorInRow}
          >
            <span class="select-none pr-3 text-faint">{hex(rowStart, 6)}</span>
            <span class="pr-4">
              {#each Array.from({ length: rowEnd - rowStart }, (_, i) => rowStart + i) as off (off)}
                {@const isCursor =
                  off >= app.cursor && off < app.cursor + app.cursorSize}
                {@const ei = editInfo(off)}
                {@const printable = isPrintable(effectiveByte(off))}
                {@const highlighted =
                  app.highlightRange !== null &&
                  off >= app.highlightRange.start &&
                  off < app.highlightRange.end}
                {@const changed = (app.binaryRev, isByteChanged(off))}
                <button
                  type="button"
                  onclick={() => {
                    if (editor.start !== null) return;
                    setCursor(off, 1);
                  }}
                  ondblclick={() => startEdit(off)}
                  class="inline-block px-1 transition"
                  class:bg-accent={ei.editing || isCursor}
                  class:text-black={ei.editing || isCursor}
                  class:ring-2={highlighted && !isCursor && !ei.editing}
                  class:ring-accent={highlighted && !isCursor && !ei.editing}
                  class:ring-opacity-50={highlighted && !isCursor && !ei.editing}
                  class:ring-1={ei.editing && !ei.finalized}
                  class:ring-accent-muted={ei.editing && !ei.finalized}
                  class:text-amber-400={changed && !isCursor && !ei.editing}
                  class:font-bold={changed && !isCursor && !ei.editing}
                  class:text-muted={!changed && !isCursor && !ei.editing && !printable}
                  class:text-foreground={!changed && !isCursor && !ei.editing && printable}
                  title={ei.editing
                    ? "Editing — Enter to accept, Esc to cancel"
                    : changed
                      ? `0x${hex(off, 6)} — changed from 0x${hex(app.binaryOrig?.[off] ?? 0, 2)}`
                      : `0x${hex(off, 6)} — double-click to edit`}
                >{ei.display ?? hex(bytes[off], 2)}</button>
              {/each}
              {#if rowEnd - rowStart < BYTES_PER_ROW}
                <span>{"   ".repeat(BYTES_PER_ROW - (rowEnd - rowStart))}</span>
              {/if}
            </span>

            {#if useBars}
              {@const barCells = rowBars(rowStart, app.contentsMode)}
              <span class="flex items-center gap-0.5 border-l border-divider pl-3">
                {#each barCells as cell, i (i)}
                  {@const cellActive =
                    cell.fits &&
                    app.cursor === cell.offset &&
                    app.cursorSize === cell.bytesPerCell}
                  <button
                    type="button"
                    class="relative inline-block h-3.5 rounded-sm bg-base/0 transition hover:bg-elevated disabled:cursor-default disabled:hover:bg-base/0"
                    class:ring-1={cellActive}
                    class:ring-accent={cellActive}
                    style="width: {contentsMeta.cellChars * 0.6}rem;"
                    title={cell.fits ? cell.value.toString() : ""}
                    onclick={() => {
                      if (editor.start !== null || !cell.fits) return;
                      setCursor(cell.offset, cell.bytesPerCell);
                    }}
                    disabled={!cell.fits || editor.start !== null}
                  >
                    {#if cell.fits}
                      {#if cell.signed}
                        <span class="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-divider"></span>
                        {#if cell.pct >= 0}
                          <span
                            class="pointer-events-none absolute inset-y-0.5 left-1/2 bg-accent/70"
                            style="width: {cell.pct / 2}%;"
                          ></span>
                        {:else}
                          <span
                            class="pointer-events-none absolute inset-y-0.5 bg-accent/70"
                            style="right: 50%; width: {-cell.pct / 2}%;"
                          ></span>
                        {/if}
                      {:else}
                        <span
                          class="pointer-events-none absolute inset-y-0.5 left-0 bg-accent/70"
                          style="width: {cell.pct}%;"
                        ></span>
                      {/if}
                    {/if}
                  </button>
                {/each}
              </span>
            {:else}
              {@const textCells = rowContentsCells(rowStart, app.contentsMode)}
              {@const separator = app.contentsMode === "ascii" ? "" : " "}
              <span class="flex items-center whitespace-pre border-l border-divider pl-3 text-muted">
                {#each textCells as cell, i (i)}
                  {@const cellActive =
                    cell.fits &&
                    app.cursor === cell.offset &&
                    app.cursorSize === cell.bytesPerCell}
                  <!--
                    Each cell button gets some horizontal padding + a
                    min-width so single-character ASCII still presents a
                    comfortable click target. min-width is measured in
                    `ch` so it tracks the monospace metric — keeps rows
                    aligned across visible chars.
                  -->
                  <button
                    type="button"
                    class="whitespace-pre rounded-sm px-1 text-center transition hover:bg-elevated disabled:cursor-default disabled:hover:bg-transparent"
                    style="min-width: {Math.max(1.5, cell.text.length)}ch;"
                    class:bg-accent={cellActive}
                    class:text-black={cellActive}
                    class:text-muted={!cellActive}
                    onclick={() => {
                      if (editor.start !== null || !cell.fits) return;
                      setCursor(cell.offset, cell.bytesPerCell);
                    }}
                    disabled={!cell.fits || editor.start !== null}
                  >{cell.text}</button>{#if i < textCells.length - 1}{separator}{/if}
                {/each}
              </span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
