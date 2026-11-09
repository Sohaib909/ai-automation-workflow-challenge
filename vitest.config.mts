import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    // Each test file gets a fresh in-memory DB; AI_PROVIDER=mock so tests never hit the network.
    env: { STORE_FILE: ":memory:", AI_PROVIDER: "mock", IMAGE_PROVIDER: "none" },
    pool: "forks",
  },
});
