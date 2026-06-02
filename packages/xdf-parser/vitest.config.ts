import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The parser brings its own DOMParser (@xmldom/xmldom) so Node test
    // runs don't need a DOM env at all.
    environment: "node",
  },
});
