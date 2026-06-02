export function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

export function formatOffset(offset: number): string {
  return "0x" + hex(offset, 6);
}

/** Parse "0xABCD" / "ABCD" / "12345" as a non-negative integer. */
export function parseOffsetInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const isHex = /^0x/i.test(trimmed) || /^[0-9a-f]+$/i.test(trimmed) && /[a-f]/i.test(trimmed);
  const n = isHex ? parseInt(trimmed.replace(/^0x/i, ""), 16) : parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
