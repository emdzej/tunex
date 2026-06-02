import type { XdfDefinition } from "@tunex/xdf-parser";

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
  /** Loaded .xdf definition for structured editing (Milestone 2). */
  xdf: XdfDefinition | null;
  /** Filename of the .xdf for display. */
  xdfFilename: string;
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
});

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
