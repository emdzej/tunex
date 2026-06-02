import type { Config } from "tailwindcss";
import bimmerzPreset from "@emdzej/bimmerz-theme";

// Per-app accent: blue. tailwind-500 sits between inpax/ncsx for clear
// distinction without straying out of the family.
export default {
  content: ["./index.html", "./src/**/*.{ts,svelte}"],
  presets: [bimmerzPreset],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#3b82f6",
          muted: "#1d4ed8",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
