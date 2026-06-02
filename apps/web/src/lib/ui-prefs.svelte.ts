// User-interface preferences persisted to localStorage. Lighter-weight
// than `state.svelte.ts` (no app data, just visual state).

const STORAGE_KEY = "tunex:ui-prefs";

interface Stored {
  /** Right sidebar width in pixels (hex editor / "at cursor" pane). */
  sidebarWidth: number;
}

const DEFAULTS: Stored = {
  sidebarWidth: 320,
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
    return { sidebarWidth };
  } catch {
    return { ...DEFAULTS };
  }
}

export const uiPrefs = $state<Stored>(load());

export function setSidebarWidth(width: number): void {
  const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)));
  if (clamped === uiPrefs.sidebarWidth) return;
  uiPrefs.sidebarWidth = clamped;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uiPrefs));
  } catch {
    // Quota / private-browsing: silently no-op.
  }
}
