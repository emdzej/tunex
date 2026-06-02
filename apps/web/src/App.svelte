<script lang="ts">
  import { app } from "./lib/state.svelte";
  import FilePicker from "./components/FilePicker.svelte";
  import RawEditor from "./components/RawEditor.svelte";
  import StructuredEditor from "./components/StructuredEditor.svelte";
  import SaveButton from "./components/SaveButton.svelte";

  const REPO = "https://github.com/emdzej/tunex";
  const RELEASE_URL = `${REPO}/releases/tag/${__APP_VERSION__}`;

  function setView(v: typeof app.view): void {
    app.view = v;
  }

  function tabClass(active: boolean): string {
    const base = "px-3 py-1.5 text-sm rounded transition";
    return active
      ? `${base} bg-elevated text-foreground border border-divider`
      : `${base} text-muted hover:text-foreground hover:bg-elevated`;
  }
</script>

<div class="flex h-full flex-col bg-base text-foreground">
  <header class="flex items-center gap-3 border-b border-divider bg-surface px-4 py-2 text-sm">
    <button
      class="font-semibold text-foreground transition hover:opacity-80"
      onclick={() => setView(app.binary ? "raw" : "picker")}
      title="Home"
    >
      TUNE<span class="text-accent">X</span>
    </button>

    <a
      href={RELEASE_URL}
      target="_blank"
      rel="noopener noreferrer"
      class="text-xs text-faint underline-offset-2 transition hover:text-foreground hover:underline"
      title="Release notes on GitHub"
    >
      {__APP_VERSION__}
    </a>

    <a
      href={REPO}
      target="_blank"
      rel="noopener noreferrer"
      class="text-faint transition hover:text-foreground"
      title="tunex on GitHub"
      aria-label="tunex on GitHub"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
    </a>

    {#if app.binary}
      <nav class="ml-4 flex items-center gap-1">
        <button class={tabClass(app.view === "raw")} onclick={() => setView("raw")}>
          RAW
        </button>
        <button
          class={tabClass(app.view === "structured")}
          onclick={() => setView("structured")}
        >
          Structured
        </button>
      </nav>

      <span class="ml-4 truncate font-hex text-xs text-muted" title={app.filename}>
        {app.filename}
        <span class="ml-1 text-faint">({app.binary.length.toLocaleString()} bytes)</span>
        {#if app.dirty}<span class="ml-1 text-accent">●</span>{/if}
      </span>
    {/if}

    <span class="flex-1"></span>

    {#if app.binary}
      <SaveButton />
      <button
        class="rounded border border-divider bg-surface px-2 py-0.5 text-xs text-muted transition hover:border-accent hover:bg-elevated"
        onclick={() => setView("picker")}
        title="Load a different binary"
      >
        Open…
      </button>
    {/if}
  </header>

  <main class="flex-1 min-h-0 overflow-hidden">
    {#if app.view === "picker" || !app.binary}
      <FilePicker />
    {:else if app.view === "raw"}
      <RawEditor />
    {:else if app.view === "structured"}
      <StructuredEditor />
    {/if}
  </main>
</div>
