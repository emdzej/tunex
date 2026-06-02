<script lang="ts">
  import { app, writeBytes } from "../lib/state.svelte";
  import { uiPrefs, setInterpretationCollapsed } from "../lib/ui-prefs.svelte";
  import {
    EDITABLE_TYPES,
    NUMERIC_TYPE_LABELS,
    NUMERIC_TYPE_SIZES,
    encodeNumeric,
    readNumeric,
    readUtf8Char,
    type NumericType,
  } from "../lib/interpret";
  import { hex } from "../lib/format";

  let editType = $state<NumericType>("u8");
  let editValue = $state("");
  let editError = $state<string | null>(null);

  // Auto-populate the edit input with the current cursor value for
  // the chosen type. Re-fires whenever the type or cursor changes
  // (i.e. when the user moves around or picks a different type),
  // overwriting prior input — typing in between navigation isn't
  // disrupted because the effect only triggers on those deps.
  $effect(() => {
    void app.cursor; // track dependency
    const v = readSingle(editType);
    editValue = v !== null ? v.toString() : "";
    editError = null;
  });

  function formatValue(value: number | null): string {
    if (value === null) return "—";
    return value.toString();
  }

  function readPair(base: string): { le: number | null; be: number | null; fits: boolean } {
    if (!app.binary) return { le: null, be: null, fits: false };
    const leType = (base + "le") as NumericType;
    const beType = (base + "be") as NumericType;
    const size = NUMERIC_TYPE_SIZES[leType];
    const fits = app.cursor + size <= app.binary.length;
    if (!fits) return { le: null, be: null, fits: false };
    return {
      le: readNumeric(app.binary, app.cursor, leType),
      be: readNumeric(app.binary, app.cursor, beType),
      fits: true,
    };
  }

  function readSingle(type: NumericType): number | null {
    if (!app.binary) return null;
    const size = NUMERIC_TYPE_SIZES[type];
    if (app.cursor + size > app.binary.length) return null;
    return readNumeric(app.binary, app.cursor, type);
  }

  function asciiAt(): string {
    if (!app.binary || app.cursor >= app.binary.length) return "—";
    const b = app.binary[app.cursor];
    return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "·";
  }

  function utf8At(): string {
    if (!app.binary) return "—";
    return readUtf8Char(app.binary, app.cursor) ?? "—";
  }

  function commit(ev: Event): void {
    ev.preventDefault();
    if (!app.binary) return;
    const parsed = parseValue(editValue, editType);
    if (parsed === null) {
      editError = "Invalid value";
      return;
    }
    const bytes = encodeNumeric(parsed, editType);
    if (!bytes) {
      editError = "Out of range";
      return;
    }
    if (app.cursor + bytes.length > app.binary.length) {
      editError = "Past end of file";
      return;
    }
    writeBytes(app.cursor, bytes);
    editError = null;
    // Keep editValue as-is — it already matches the byte we just
    // wrote, so the input shows the current value (the auto-populate
    // effect would do the same thing on the next cursor change).
  }

  function parseValue(raw: string, type: NumericType): number | null {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const isFloat = type.startsWith("f");
    if (isFloat) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    const isHex = /^-?0x/i.test(trimmed);
    const n = isHex
      ? parseInt(trimmed.replace(/0x/i, ""), 16) * (trimmed.startsWith("-") ? -1 : 1)
      : parseInt(trimmed, 10);
    return Number.isInteger(n) ? n : null;
  }

  function toggleCollapsed(): void {
    setInterpretationCollapsed(!uiPrefs.interpretationCollapsed);
  }
</script>

<section class="bg-surface text-xs">
  <header class="flex items-center gap-2 px-3 py-1.5">
    <button
      type="button"
      class="text-faint transition hover:text-foreground"
      onclick={toggleCollapsed}
      aria-expanded={!uiPrefs.interpretationCollapsed}
      title={uiPrefs.interpretationCollapsed ? "Expand" : "Collapse"}
    >{uiPrefs.interpretationCollapsed ? "▸" : "▾"}</button>
    <h2 class="text-sm font-semibold text-foreground">At cursor</h2>
    <span class="ml-auto font-hex text-faint">
      <span class="text-foreground">0x{hex(app.cursor, 6)}</span>
      <span class="ml-1 text-faint">({app.cursor.toLocaleString()})</span>
    </span>
  </header>

  {#if !uiPrefs.interpretationCollapsed && app.binary}
    <div class="space-y-2 px-3 pb-3 font-hex">
      <!-- 1-byte: u8 / i8 / ASCII / UTF-8 on a 2x2 grid. -->
      {#snippet singleByteRow()}
        {@const u8v = readSingle("u8")}
        {@const i8v = readSingle("i8")}
        <span class="text-right text-faint">u8</span>
        <span class="text-foreground" class:text-faint={u8v === null}>
          {formatValue(u8v)}{#if u8v !== null}<span class="ml-1 text-faint">0x{hex(u8v, 2)}</span>{/if}
        </span>
        <span class="text-right text-faint">i8</span>
        <span class="text-foreground" class:text-faint={i8v === null}>{formatValue(i8v)}</span>

        <span class="text-right text-faint">ASCII</span>
        <span class="text-foreground">{asciiAt()}</span>
        <span class="text-right text-faint">UTF-8</span>
        <span class="text-foreground">{utf8At()}</span>
      {/snippet}
      <div class="grid grid-cols-[3rem_1fr_3rem_1fr] gap-x-2 gap-y-0.5">
        {@render singleByteRow()}
      </div>

      <!-- Multi-byte: LE + BE paired in one row. -->
      <div class="grid grid-cols-[3rem_1fr_1fr] gap-x-2 gap-y-0.5">
        <span class="col-start-2 text-faint">LE</span>
        <span class="text-faint">BE</span>

        {#each ["u16", "i16", "u32", "i32"] as base (base)}
          {@const pair = readPair(base)}
          <span class="text-right text-faint">{base}</span>
          <span class="text-foreground" class:text-faint={!pair.fits}>{formatValue(pair.le)}</span>
          <span class="text-foreground" class:text-faint={!pair.fits}>{formatValue(pair.be)}</span>
        {/each}

        {#each ["f32", "f64"] as base (base)}
          {@const pair = readPair(base)}
          <span class="text-right text-faint">{base}</span>
          <span class="text-foreground" class:text-faint={!pair.fits}>{formatValue(pair.le)}</span>
          <span class="text-foreground" class:text-faint={!pair.fits}>{formatValue(pair.be)}</span>
        {/each}
      </div>

      <!-- Edit form: one row, type + value + write. -->
      <form onsubmit={commit} class="space-y-1 border-t border-divider pt-2">
        <div class="flex gap-1">
          <select
            bind:value={editType}
            class="min-w-0 flex-1 rounded border border-divider bg-base px-1 py-0.5 text-foreground focus:border-accent focus:outline-none"
          >
            {#each EDITABLE_TYPES as type (type)}
              <option value={type}>{NUMERIC_TYPE_LABELS[type]}</option>
            {/each}
          </select>
          <input
            type="text"
            bind:value={editValue}
            placeholder={editType.startsWith("f") ? "3.14" : "dec / 0x…"}
            class="w-24 rounded border border-divider bg-base px-1 py-0.5 text-foreground focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            class="rounded bg-accent px-2 py-0.5 font-medium text-black transition hover:bg-accent-muted hover:text-white"
            title="Write at 0x{hex(app.cursor, 6)}"
          >Write</button>
        </div>
        {#if editError}
          <p class="text-red-500">{editError}</p>
        {/if}
      </form>
    </div>
  {/if}
</section>
