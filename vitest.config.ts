import { defineConfig } from "vitest/config";

export default defineConfig({
  // Convex guidelines: run Convex function tests in the edge-runtime VM
  // (matches the default Convex runtime). Node-dependent tests override
  // per-file with an @vitest-environment node docblock.
  test: {
    environment: "edge-runtime",
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
  },
});
