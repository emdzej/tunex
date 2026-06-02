<script lang="ts">
  import { app, setCursor } from "../lib/state.svelte";
  import {
    bookmarks,
    listFolders,
    bookmarksInFolder,
    addBookmark,
    updateBookmark,
    deleteBookmark,
    addFolder,
    renameFolder,
    deleteFolder,
    ROOT_FOLDER_ID,
    type Bookmark,
  } from "../lib/bookmarks.svelte";
  import { hex, parseOffsetInput } from "../lib/format";

  // Form / editing state. Only one form/edit can be active at a time;
  // each is identified by a sentinel string so the templates stay terse.
  type ActiveUi =
    | { kind: "none" }
    | { kind: "new-bookmark" }
    | { kind: "edit-bookmark"; id: string }
    | { kind: "new-folder" }
    | { kind: "rename-folder"; id: string };

  let active = $state<ActiveUi>({ kind: "none" });

  // Shared form fields (re-used by new + edit so the inputs sit in the
  // same DOM nodes — fewer focus surprises).
  let formOffset = $state("");
  let formName = $state("");
  let formDescription = $state("");
  let formFolderId = $state(ROOT_FOLDER_ID);
  let formError = $state<string | null>(null);

  let folderNameInput = $state("");
  let folderError = $state<string | null>(null);

  let collapsed = $state<Record<string, boolean>>({});

  const folders = $derived(listFolders());
  const totalCount = $derived(bookmarks.bookmarks.length);

  function openNewBookmark(): void {
    active = { kind: "new-bookmark" };
    formOffset = "0x" + hex(app.cursor, 6);
    formName = "";
    formDescription = "";
    formFolderId = ROOT_FOLDER_ID;
    formError = null;
  }

  function openEditBookmark(bm: Bookmark): void {
    active = { kind: "edit-bookmark", id: bm.id };
    formOffset = "0x" + hex(bm.offset, 6);
    formName = bm.name;
    formDescription = bm.description;
    formFolderId = bm.folderId;
    formError = null;
  }

  function submitBookmark(ev: Event): void {
    ev.preventDefault();
    const offset = parseOffsetInput(formOffset);
    if (offset === null) {
      formError = "Offset must be a decimal or 0x… hex number";
      return;
    }
    if (app.binary && offset >= app.binary.length) {
      formError = `Offset is past the end (max 0x${hex(app.binary.length - 1, 6)})`;
      return;
    }
    const name = formName.trim();
    if (!name) {
      formError = "Name is required";
      return;
    }
    if (active.kind === "new-bookmark") {
      addBookmark({
        offset,
        name,
        description: formDescription,
        folderId: formFolderId,
      });
    } else if (active.kind === "edit-bookmark") {
      updateBookmark(active.id, {
        offset,
        name,
        description: formDescription,
        folderId: formFolderId,
      });
    }
    active = { kind: "none" };
  }

  function openNewFolder(): void {
    active = { kind: "new-folder" };
    folderNameInput = "";
    folderError = null;
  }

  function openRenameFolder(id: string, currentName: string): void {
    active = { kind: "rename-folder", id };
    folderNameInput = currentName;
    folderError = null;
  }

  function submitFolder(ev: Event): void {
    ev.preventDefault();
    const name = folderNameInput.trim();
    if (!name) {
      folderError = "Name is required";
      return;
    }
    if (active.kind === "new-folder") {
      addFolder(name);
    } else if (active.kind === "rename-folder") {
      renameFolder(active.id, name);
    }
    active = { kind: "none" };
  }

  function cancel(): void {
    active = { kind: "none" };
    formError = null;
    folderError = null;
  }

  function toggleCollapsed(id: string): void {
    collapsed[id] = !collapsed[id];
  }

  function confirmDeleteFolder(id: string, name: string): void {
    const count = bookmarksInFolder(id).length;
    const message = count
      ? `Delete folder "${name}"? Its ${count} bookmark${count === 1 ? "" : "s"} will move to Root.`
      : `Delete folder "${name}"?`;
    if (window.confirm(message)) {
      deleteFolder(id);
    }
  }
</script>

<section class="flex flex-col gap-2 bg-surface p-3 text-xs">
  <header class="flex items-center justify-between">
    <h2 class="text-sm font-semibold text-foreground">
      Bookmarks
      <span class="text-faint">({totalCount})</span>
    </h2>
    <div class="flex items-center gap-1">
      <button
        class="rounded border border-divider bg-elevated px-2 py-0.5 text-xs text-foreground transition hover:border-accent"
        onclick={openNewBookmark}
        disabled={!app.binary}
        title="Add bookmark at cursor"
      >+ Bookmark</button>
      <button
        class="rounded border border-divider bg-elevated px-2 py-0.5 text-xs text-foreground transition hover:border-accent"
        onclick={openNewFolder}
        title="Add folder"
      >+ Folder</button>
    </div>
  </header>

  {#if active.kind === "new-bookmark" || active.kind === "edit-bookmark"}
    <form onsubmit={submitBookmark} class="flex flex-col gap-2 rounded border border-divider bg-elevated p-2">
      <label class="flex flex-col gap-0.5">
        <span class="text-faint">Offset</span>
        <input
          type="text"
          bind:value={formOffset}
          class="rounded border border-divider bg-surface px-2 py-1 font-hex text-foreground focus:border-accent focus:outline-none"
          placeholder="0x… or decimal"
        />
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-faint">Name</span>
        <input
          type="text"
          bind:value={formName}
          class="rounded border border-divider bg-surface px-2 py-1 text-foreground focus:border-accent focus:outline-none"
        />
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-faint">Description</span>
        <textarea
          bind:value={formDescription}
          rows="2"
          class="rounded border border-divider bg-surface px-2 py-1 text-foreground focus:border-accent focus:outline-none"
        ></textarea>
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-faint">Folder</span>
        <select
          bind:value={formFolderId}
          class="rounded border border-divider bg-surface px-2 py-1 text-foreground focus:border-accent focus:outline-none"
        >
          {#each folders as folder (folder.id)}
            <option value={folder.id}>{folder.name}</option>
          {/each}
        </select>
      </label>
      {#if formError}
        <p class="text-red-500">{formError}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded px-2 py-1 text-muted transition hover:text-foreground"
          onclick={cancel}
        >Cancel</button>
        <button
          type="submit"
          class="rounded bg-accent px-2 py-1 font-medium text-black transition hover:bg-accent-muted hover:text-white"
        >{active.kind === "new-bookmark" ? "Add" : "Save"}</button>
      </div>
    </form>
  {/if}

  {#if active.kind === "new-folder" || active.kind === "rename-folder"}
    <form onsubmit={submitFolder} class="flex items-center gap-2 rounded border border-divider bg-elevated p-2">
      <input
        type="text"
        bind:value={folderNameInput}
        placeholder="Folder name"
        class="flex-1 rounded border border-divider bg-surface px-2 py-1 text-foreground focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        class="rounded bg-accent px-2 py-1 font-medium text-black transition hover:bg-accent-muted hover:text-white"
      >{active.kind === "new-folder" ? "Add" : "Save"}</button>
      <button
        type="button"
        class="rounded px-2 py-1 text-muted transition hover:text-foreground"
        onclick={cancel}
      >Cancel</button>
    </form>
    {#if folderError}
      <p class="text-red-500">{folderError}</p>
    {/if}
  {/if}

  <div class="flex flex-col gap-2">
    {#each folders as folder (folder.id)}
      {@const items = bookmarksInFolder(folder.id)}
      {@const open = !collapsed[folder.id]}
      <div class="rounded border border-divider bg-base">
        <header class="flex items-center gap-1 px-2 py-1">
          <button
            type="button"
            class="text-faint transition hover:text-foreground"
            onclick={() => toggleCollapsed(folder.id)}
            title={open ? "Collapse" : "Expand"}
            aria-label={open ? "Collapse folder" : "Expand folder"}
          >{open ? "▾" : "▸"}</button>
          <span class="flex-1 truncate font-medium text-foreground" title={folder.name}>
            {folder.name}
            <span class="ml-1 text-faint">({items.length})</span>
          </span>
          {#if folder.id !== ROOT_FOLDER_ID}
            <button
              type="button"
              class="text-faint transition hover:text-foreground"
              onclick={() => openRenameFolder(folder.id, folder.name)}
              title="Rename folder"
              aria-label="Rename folder"
            >✎</button>
            <button
              type="button"
              class="text-faint transition hover:text-red-500"
              onclick={() => confirmDeleteFolder(folder.id, folder.name)}
              title="Delete folder (bookmarks move to Root)"
              aria-label="Delete folder"
            >✕</button>
          {/if}
        </header>

        {#if open}
          {#if items.length === 0}
            <p class="px-2 py-1 text-faint">No bookmarks</p>
          {:else}
            <ul class="divide-y divide-divider">
              {#each items as bm (bm.id)}
                <li class="group flex flex-col px-2 py-1 hover:bg-elevated">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="font-hex text-faint transition hover:text-accent"
                      onclick={() => setCursor(bm.offset)}
                      title="Jump to 0x{hex(bm.offset, 6)}"
                    >0x{hex(bm.offset, 6)}</button>
                    <button
                      type="button"
                      class="flex-1 truncate text-left text-foreground transition hover:text-accent"
                      onclick={() => setCursor(bm.offset)}
                      title={bm.name}
                    >{bm.name}</button>
                    <button
                      type="button"
                      class="text-faint opacity-0 transition hover:text-foreground group-hover:opacity-100"
                      onclick={() => openEditBookmark(bm)}
                      title="Edit bookmark"
                      aria-label="Edit bookmark"
                    >✎</button>
                    <button
                      type="button"
                      class="text-faint opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                      onclick={() => deleteBookmark(bm.id)}
                      title="Delete bookmark"
                      aria-label="Delete bookmark"
                    >✕</button>
                  </div>
                  {#if bm.description}
                    <p class="ml-[3.5rem] text-faint">{bm.description}</p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>
    {/each}
  </div>
</section>
