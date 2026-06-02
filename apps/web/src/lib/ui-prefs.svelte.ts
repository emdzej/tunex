// User-interface preferences persisted to localStorage. Lighter-weight
// than `state.svelte.ts` (no app data, just visual state).

const STORAGE_KEY = "tunex:ui-prefs";

interface Stored {
  /** Right sidebar width in pixels (hex editor / "at cursor" pane). */
  sidebarWidth: number;
  /** When true, the "At cursor" interpretation panel collapses to a single header row. */
  interpretationCollapsed: boolean;
}

const DEFAULTS: Stored = {
  sidebarWidth: 320,
  interpretationCollapsed: false,
};

// Hard bounds — keep the hex view usable on small windows but allow
// the sidebar to expand for users with wide monitors and big bookmark
// lists.
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 800;

function load(): Stored {
  if (typeof localStorage === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const sidebarWidth =
      typeof parsed.sidebarWidth === "number" &&
      Number.isFinite(parsed.sidebarWidth)
        ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parsed.sidebarWidth))
        : DEFAULTS.sidebarWidth;
    const interpretationCollapsed =
      typeof parsed.interpretationCollapsed === "boolean"
        ? parsed.interpretationCollapsed
        : DEFAULTS.interpretationCollapsed;
    return { sidebarWidth, interpretationCollapsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export const uiPrefs = $state<Stored>(load());

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uiPrefs));
  } catch {
    // Quota / private-browsing: silently no-op.
  }
}

export function setSidebarWidth(width: number): void {
  const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)));
  if (clamped === uiPrefs.sidebarWidth) return;
  uiPrefs.sidebarWidth = clamped;
  persist();
}

export function setInterpretationCollapsed(collapsed: boolean): void {
  if (collapsed === uiPrefs.interpretationCollapsed) return;
  uiPrefs.interpretationCollapsed = collapsed;
  persist();
}
