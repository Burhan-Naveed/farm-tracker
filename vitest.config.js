import { defineConfig } from "vitest/config";

// Two test groups: fast unit tests (no Firebase) and security-rules tests (need the Firestore emulator).
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.js"], environment: "node" } },
      { test: { name: "rules", include: ["tests/rules/**/*.test.js"], environment: "node", testTimeout: 20000, fileParallelism: false } }
    ]
  }
});
