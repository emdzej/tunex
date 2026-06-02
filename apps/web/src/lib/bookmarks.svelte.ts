// Bookmarks: named offsets persisted to localStorage, organised into
// one level of user-defined folders. The "Root" folder is synthetic —
// always present, never renamed or deleted — and is the default
// destination for folder-less bookmarks (and the dumping ground when
// a user-defined folder is deleted).

const STORAGE_KEY = "tunex:bookmarks";
export const ROOT_FOLDER_ID = "root";
export const ROOT_FOLDER_NAME = "Root";

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  folderId: string;
  offset: number;
  name: string;
  description: string;
  createdAt: number;
}

interface Stored {
  folders: Folder[];
  bookmarks: Bookmark[];
}

function isFolder(x: unknown): x is Folder {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id !== ROOT_FOLDER_ID &&
    typeof o.name === "string" &&
    typeof o.createdAt === "number"
  );
}

function isBookmark(x: unknown): x is Bookmark {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.folderId === "string" &&
    typeof o.offset === "number" &&
    Number.isFinite(o.offset) &&
    typeof o.name === "string" &&
    typeof o.description === "string" &&
    typeof o.createdAt === "number"
  );
}

function load(): Stored {
  if (typeof localStorage === "undefined") return { folders: [], bookmarks: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { folders: [], bookmarks: [] };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { folders: [], bookmarks: [] };
    }
    const p = parsed as Record<string, unknown>;
    const folders = Array.isArray(p.folders) ? p.folders.filter(isFolder) : [];
    const folderIds = new Set([ROOT_FOLDER_ID, ...folders.map((f) => f.id)]);
    const bookmarks = (Array.isArray(p.bookmarks) ? p.bookmarks.filter(isBookmark) : [])
      // Re-home orphans (folder was deleted in a way that bypassed our migration).
      .map((b) => (folderIds.has(b.folderId) ? b : { ...b, folderId: ROOT_FOLDER_ID }));
    return { folders, bookmarks };
  } catch {
    return { folders: [], bookmarks: [] };
  }
}

export const bookmarks = $state<Stored>(load());

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // Quota / private-browsing: silently no-op. In-memory state still works.
  }
}

/** Folders including the synthetic Root, ordered Root → creation. */
export function listFolders(): Folder[] {
  return [
    { id: ROOT_FOLDER_ID, name: ROOT_FOLDER_NAME, createdAt: 0 },
    ...bookmarks.folders.slice().sort((a, b) => a.createdAt - b.createdAt),
  ];
}

/** Bookmarks in a folder, sorted by offset. */
export function bookmarksInFolder(folderId: string): Bookmark[] {
  return bookmarks.bookmarks
    .filter((b) => b.folderId === folderId)
    .sort((a, b) => a.offset - b.offset);
}

export function addBookmark(input: {
  offset: number;
  name: string;
  description: string;
  folderId: string;
}): Bookmark {
  const bm: Bookmark = {
    id: crypto.randomUUID(),
    folderId: input.folderId || ROOT_FOLDER_ID,
    offset: input.offset,
    name: input.name,
    description: input.description,
    createdAt: Date.now(),
  };
  bookmarks.bookmarks = [...bookmarks.bookmarks, bm];
  persist();
  return bm;
}

export function updateBookmark(
  id: string,
  patch: Partial<Pick<Bookmark, "offset" | "name" | "description" | "folderId">>,
): void {
  bookmarks.bookmarks = bookmarks.bookmarks.map((b) =>
    b.id === id ? { ...b, ...patch } : b,
  );
  persist();
}

export function deleteBookmark(id: string): void {
  bookmarks.bookmarks = bookmarks.bookmarks.filter((b) => b.id !== id);
  persist();
}

export function addFolder(name: string): Folder | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const folder: Folder = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: Date.now(),
  };
  bookmarks.folders = [...bookmarks.folders, folder];
  persist();
  return folder;
}

export function renameFolder(id: string, name: string): void {
  if (id === ROOT_FOLDER_ID) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  bookmarks.folders = bookmarks.folders.map((f) =>
    f.id === id ? { ...f, name: trimmed } : f,
  );
  persist();
}

/** Deleting a folder moves its bookmarks into Root rather than dropping them. */
export function deleteFolder(id: string): void {
  if (id === ROOT_FOLDER_ID) return;
  bookmarks.bookmarks = bookmarks.bookmarks.map((b) =>
    b.folderId === id ? { ...b, folderId: ROOT_FOLDER_ID } : b,
  );
  bookmarks.folders = bookmarks.folders.filter((f) => f.id !== id);
  persist();
}
