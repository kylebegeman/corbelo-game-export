import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Every report a test makes is held to plain words as it is made.
    setupFiles: ["test/plain-words.setup.ts"],
    testTimeout: 30_000,
  },
});
