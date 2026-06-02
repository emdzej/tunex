import type { XdfDefinition, XdfItem } from "@tunex/xdf-parser";
import { parseXdf, XdfParseError, resolveAddress, resolveEmbedded } from "@tunex/xdf-parser";

export type AppView = "picker" | "raw" | "structured";

export type ContentsMode =
  | "ascii"
  | "u8"
  | "u16le"
  | "u16be"
  | "i16le"
  | "i16be"
  | "u32le"
  | "i32le";

// Single source of truth. Components import `app` and read/write
// fields directly — Svelte 5 runes propagate updates without an
// explicit store API.
export const app = $state<{
  view: AppView;
  /** Loaded firmware bytes. `null` when no file is mounted. */
  binary: Uint8Array | null;
  /** Original filename — preserved across edits so Save reuses it. */
  filename: string;
  /** Has the binary been modified since load? */
  dirty: boolean;
  /** Current cursor (byte offset). Always clamped to binary bounds. */
  cursor: number;
  /** Right-column contents rendering. */
  contentsMode: ContentsMode;
  /** Render numeric contents as horizontal bars instead of digits. */
  contentsBars: boolean;
  /** Loaded .xdf definition for structured editing. */
  xdf: XdfDefinition | null;
  /** Filename of the .xdf for display. */
  xdfFilename: string;
  /** Last XDF parse error message (null when none / cleared on success). */
  xdfError: string | null;
  /** uniqueid of the currently focused structured item. */
  selectedItemId: number | null;
  /** Byte range to highlight in the hex view (cross-link from structured). */
  highlightRange: { start: number; end: number } | null;
}>({
  view: "picker",
  binary: null,
  filename: "",
  dirty: false,
  cursor: 0,
  contentsMode: "ascii",
  contentsBars: false,
  xdf: null,
  xdfFilename: "",
  xdfError: null,
  selectedItemId: null,
  highlightRange: null,
});

export function loadXdf(text: string, filename: string): void {
  try {
    app.xdf = parseXdf(text);
    app.xdfFilename = filename;
    app.xdfError = null;
    app.selectedItemId = null;
    app.highlightRange = null;
  } catch (err) {
    app.xdf = null;
    app.xdfFilename = filename;
    app.xdfError =
      err instanceof XdfParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
  }
}

export function selectXdfItem(item: XdfItem | null): void {
  app.selectedItemId = item?.uniqueid ?? null;
  app.highlightRange = itemByteRange(item, app.xdf);
}

export function findXdfItem(id: number | null): XdfItem | null {
  if (id === null || !app.xdf) return null;
  return app.xdf.items.find((i) => i.uniqueid === id) ?? null;
}

/**
 * Byte span covered by an item (after resolving BASEOFFSET). Used to
 * highlight the corresponding bytes in the hex view and to jump the
 * cursor when the user clicks "Jump to bytes".
 *
 * Returns null for tables (multi-region — full overlay isn't useful)
 * and for items whose embed couldn't be resolved.
 */
export function itemByteRange(
  item: XdfItem | null,
  xdf: XdfDefinition | null,
): { start: number; end: number } | null {
  if (!item || !xdf) return null;
  switch (item.kind) {
    case "constant":
    case "flag": {
      const spec = resolveEmbedded(item.embed, xdf.header.baseOffset, xdf.header.defaults);
      const size = Math.max(1, Math.ceil(spec.sizeBits / 8));
      return { start: spec.address, end: spec.address + size };
    }
    case "patch": {
      if (item.entries.length === 0) return null;
      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;
      for (const e of item.entries) {
        // BASEOFFSET applies uniformly across the XDF — same assumption
        // as embed addresses. The MS42/MS43 samples both use offset=0,
        // so this is unverified for non-zero offsets.
        const addr = resolveAddress(e.address, xdf.header.baseOffset);
        if (addr < start) start = addr;
        if (addr + e.datasize > end) end = addr + e.datasize;
      }
      return { start, end };
    }
    case "table": {
      // Z (data) axis covers the table's actual bytes. Use rowcount×colcount
      // × element size to bound the highlight — falls back to size from
      // indexcount when rowcount/colcount aren't populated.
      const z = item.axes.find((a) => a.id === "z");
      if (!z) return null;
      const spec = resolveEmbedded(z.embed, xdf.header.baseOffset, xdf.header.defaults);
      const rows = z.embed.rowcount > 0 ? z.embed.rowcount : 1;
      const cols = z.embed.colcount > 0 ? z.embed.colcount : Math.max(1, z.indexcount);
      const elBytes = Math.max(1, Math.ceil(spec.sizeBits / 8));
      const bytes = rows * cols * elBytes;
      return { start: spec.address, end: spec.address + bytes };
    }
  }
}

// Inline hex-edit session state. Tracks the start byte and a raw input
// buffer of accumulated hex chars (spaces ignored). $derived helpers
// expose the parsed-byte view to the renderer.
export const editor = $state<{ start: number | null; buffer: string }>({
  start: null,
  buffer: "",
});

/** Parsed bytes from the edit buffer (completed pairs only). */
export function editPendingBytes(): number[] {
  if (editor.start === null) return [];
  const cleaned = editor.buffer.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    out.push(parseInt(cleaned.slice(i, i + 2), 16));
  }
  return out;
}

/** Single trailing nibble being typed (one hex char) or null. */
export function editPendingPartial(): string | null {
  if (editor.start === null) return null;
  const cleaned = editor.buffer.replace(/\s+/g, "");
  return cleaned.length % 2 === 1 ? cleaned[cleaned.length - 1].toUpperCase() : null;
}

export function startEdit(offset: number): void {
  // Commit any in-progress session first so a double-click on a different
  // byte preserves the typed bytes instead of silently discarding them.
  commitEdit();
  if (!app.binary) return;
  if (offset < 0 || offset >= app.binary.length) return;
  editor.start = offset;
  editor.buffer = "";
  setCursor(offset);
}

export function commitEdit(): void {
  if (editor.start === null) return;
  const bytes = editPendingBytes();
  if (bytes.length > 0) {
    writeBytes(editor.start, new Uint8Array(bytes));
    setCursor(editor.start + bytes.length - 1);
  }
  editor.start = null;
  editor.buffer = "";
}

export function cancelEdit(): void {
  editor.start = null;
  editor.buffer = "";
}

/**
 * Append a single character to the edit buffer. Hex digits and spaces
 * accepted; everything else ignored. Returns false when the buffer
 * would overflow past the end of the binary.
 */
export function appendEditChar(ch: string): boolean {
  if (editor.start === null || !app.binary) return false;
  if (ch !== " " && !/^[0-9a-fA-F]$/.test(ch)) return false;
  const next = (editor.buffer + ch).toUpperCase();
  const cleaned = next.replace(/\s+/g, "");
  const maxBytes = app.binary.length - editor.start;
  if (cleaned.length > maxBytes * 2) return false;
  editor.buffer = next;
  return true;
}

export function popEditChar(): void {
  if (editor.start === null) return;
  editor.buffer = editor.buffer.slice(0, -1);
}

export function loadBinary(bytes: Uint8Array, filename: string): void {
  app.binary = bytes;
  app.filename = filename;
  app.dirty = false;
  app.cursor = 0;
  app.view = "raw";
}

export function setCursor(offset: number): void {
  if (!app.binary) return;
  const max = app.binary.length - 1;
  app.cursor = Math.max(0, Math.min(max, offset));
}

export function writeByte(offset: number, value: number): void {
  if (!app.binary) return;
  if (offset < 0 || offset >= app.binary.length) return;
  if (app.binary[offset] === (value & 0xff)) return;
  app.binary[offset] = value & 0xff;
  app.dirty = true;
}

export function writeBytes(offset: number, bytes: Uint8Array): void {
  if (!app.binary) return;
  if (offset < 0 || offset + bytes.length > app.binary.length) return;
  let changed = false;
  for (let i = 0; i < bytes.length; i++) {
    if (app.binary[offset + i] !== bytes[i]) {
      app.binary[offset + i] = bytes[i];
      changed = true;
    }
  }
  if (changed) app.dirty = true;
}
