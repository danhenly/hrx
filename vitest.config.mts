import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
    // Keep RAM flat (~150-250 MB) so Hermes can run mutation tests safely on the VPS.
    fileParallelism: false,
    maxWorkers: 1,
    include: ["tests/convex/**/*.test.ts"],
  },
});
