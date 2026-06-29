import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Integration tests spawn real microVMs; give them room.
    testTimeout: 60_000,
  },
});
