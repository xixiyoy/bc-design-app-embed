import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "extensions/**/*.test.js"],
    environmentMatchGlobs: [
      ["extensions/**/*.test.js", "happy-dom"],
    ],
  },
});
