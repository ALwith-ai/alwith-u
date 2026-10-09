import path from "node:path"
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

export default defineConfig({
  root: path.resolve(import.meta.dirname, ".."),
  plugins: [storybookTest({ configDir: import.meta.dirname, storybookUrl: "http://127.0.0.1:6007" })],
  publicDir: false,
  test: {
    name: "storybook",
    testTimeout: 30_000,
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { channel: process.env.STORYBOOK_BROWSER_CHANNEL } }),
      headless: true,
      instances: [{ browser: "chromium" }]
    }
  }
})
