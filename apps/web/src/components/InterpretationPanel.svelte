<script lang="ts">
  import { app, writeBytes } from "../lib/state.svelte";
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

  const READ_TYPES: NumericType[] = [
    "u8",
    "i8",
    "u16le",
    "u16be",
    "i16le",
    "i16be",
    "u32le",
    "u32be",
    "i32le",
    "i32be",
    "f32le",
    "f32be",
    "f64le",
    "f64be",
  ];

  let editType = $state<NumericType>("u8");
  let editValue = $state("");
  let editError = $state<string | null>(null);

  function format(value: number | null, type: NumericType): string {
    if (value === null) return "—";
    if (type === "f32le" || type === "f32be" || type === "f64le" || type === "f64be") {
      return value.toString();
    }
    return value.toString();
  }

  function commit(ev: Event): void {
    ev.preventDefault();
    if (!app.binary) return;
    const parsed = parseValue(editValue, editType);
    if (parsed === null) {
      editError = "Invalid value for this type";
      return;
    }
    const bytes = encodeNumeric(parsed, editType);
    if (!bytes) {
      editError = "Value out of range";
      return;
    }
    if (app.cursor + bytes.length > app.binary.length) {
      editError = "Would write past end of file";
      return;
    }
    writeBytes(app.cursor, bytes);
    editError = null;
    editValue = "";
  }

  function parseValue(raw: string, type: NumericType): number | null {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const isFloat = type.startsWith("f");
    if (isFloat) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    // Allow hex for ints.
    const isHex = /^0x/i.test(trimmed) || /^-?0x/i.test(trimmed);
    const n = isHex
      ? parseInt(trimmed.replace(/0x/i, ""), 16) * (trimmed.startsWith("-") ? -1 : 1)
      : parseInt(trimmed, 10);
    return Number.isInteger(n) ? n : null;
  }
</script>

<div class="flex flex-col gap-3 bg-surface p-3 text-xs">
  <div>
    <h2 class="text-sm font-semibold text-foreground">At cursor</h2>
    <p class="font-hex text-muted">
      Offset <span class="text-foreground">0x{hex(app.cursor, 6)}</span>
      <span class="text-faint">({app.cursor.toLocaleString()})</span>
    </p>
  </div>

  {#if app.binary}
    <table class="w-full border-separate border-spacing-y-0.5 font-hex">
      <tbody>
        {#each READ_TYPES as type (type)}
          {@const size = NUMERIC_TYPE_SIZES[type]}
          {@const fits = app.cursor + size <= app.binary.length}
          {@const val = fits ? readNumeric(app.binary, app.cursor, type) : null}
          <tr>
            <td class="pr-2 text-right text-faint">{NUMERIC_TYPE_LABELS[type]}</td>
            <td class="text-foreground" class:text-faint={!fits}>
              {fits ? format(val, type) : "—"}
            </td>
            {#if (type === "u8" || type === "u16le" || type === "u32le") && fits && val !== null}
              <td class="pl-2 text-faint">
                0x{hex(val, size * 2)}
              </td>
            {/if}
          </tr>
        {/each}
        <tr>
          <td class="pr-2 text-right text-faint">ASCII</td>
          <td class="text-foreground">
            {#if app.cursor < app.binary.length}
              {@const b = app.binary[app.cursor]}
              {#if b >= 0x20 && b <= 0x7e}
                {String.fromCharCode(b)}
              {:else}
                <span class="text-faint">·</span>
              {/if}
            {/if}
          </td>
        </tr>
        <tr>
          <td class="pr-2 text-right text-faint">UTF-8</td>
          <td class="text-foreground">
            {readUtf8Char(app.binary, app.cursor) ?? "—"}
          </td>
        </tr>
      </tbody>
    </table>

    <div class="border-t border-divider pt-3">
      <h3 class="mb-2 text-sm font-semibold text-foreground">Edit as type</h3>
      <form onsubmit={commit} class="flex flex-col gap-2">
        <select
          bind:value={editType}
          class="rounded border border-divider bg-surface px-2 py-1 text-xs text-foreground focus:border-accent focus:outline-none"
        >
          {#each EDITABLE_TYPES as type (type)}
            <option value={type}>{NUMERIC_TYPE_LABELS[type]} ({NUMERIC_TYPE_SIZES[type]}B)</option>
          {/each}
        </select>
        <input
          type="text"
          bind:value={editValue}
          placeholder={editType.startsWith("f") ? "e.g. 3.14" : "decimal or 0x…"}
          class="rounded border border-divider bg-surface px-2 py-1 font-hex text-xs text-foreground focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          class="rounded bg-accent px-2 py-1 text-xs font-medium text-black transition hover:bg-accent-muted hover:text-white"
        >
          Write at 0x{hex(app.cursor, 6)}
        </button>
        {#if editError}
          <p class="text-red-500">{editError}</p>
        {/if}
      </form>
    </div>
  {/if}
</div>
