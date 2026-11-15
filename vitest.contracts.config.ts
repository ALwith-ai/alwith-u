import { defineConfig } from "vitest/config"

// Contracts drive a launched test application over its Hasgard socket (TAURI_HASGARD_SOCKET), so
// they are no part of `vitest run`: run them with `bun run test:contracts` or one of `test:browser*`.
// The steps of a contract build on one another, in order, in one application: files run one at a
// time and a failed step ends the run. Vitest itself runs on Bun here, whose server the fixtures use.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/contracts/**/*.contract.ts"],
    fileParallelism: false,
    bail: 1,
    testTimeout: 120000,
    hookTimeout: 120000,
    reporters: ["verbose"]
  }
})
