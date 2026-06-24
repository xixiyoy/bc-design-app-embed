import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "app",
          environment: "node",
          include: ["app/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "extensions",
          environment: "happy-dom",
          include: ["extensions/**/*.test.js"],
        },
      },
    ],
  },
});
