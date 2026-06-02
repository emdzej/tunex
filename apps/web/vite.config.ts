import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { VitePWA } from "vite-plugin-pwa";

// Read the version from the workspace root `package.json` rather than
// the app's own — keeps a single source of truth for git tags / release
// pages / the hub's version pill. apps/web/package.json's version
// field is unused.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };

// When deploying to GitHub Pages under https://emdzej.github.io/tunex/
// the site is served from the `/tunex/` sub-path; set TUNEX_BASE_PATH
// in CI to make every asset URL absolute under that prefix. Local
// development stays at `/`.
const basePath = process.env.TUNEX_BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "tunex",
        short_name: "tunex",
        description: "Web-based ECU firmware editor following TunerPro conventions.",
        theme_color: "#3b82f6",
        background_color: "#ffffff",
        display: "standalone",
        start_url: basePath,
        scope: basePath,
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
      },
    }),
  ],
  server: {
    // ediabasx=5173, inpax=5174, ncsx=5175. tunex takes 5176.
    port: 5176,
  },
  optimizeDeps: {
    include: ["@tunex/xdf-parser"],
  },
});
