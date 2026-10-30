import path from "node:path"

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

export default defineConfig({
  define: { "import.meta.env.STORYBOOK_TEST": "true" },
  root: path.resolve(import.meta.dirname, ".."),
  plugins: [
    storybookTest({ configDir: import.meta.dirname, storybookUrl: "http://127.0.0.1:6007" }),
    {
      name: "storybook-unicode-paths",
      enforce: "post",
      transform(code, id) {
        if (id.includes(".stories.") && code.includes("import.meta.url"))
          return code.replaceAll("import.meta.url", "decodeURI(import.meta.url)")
      }
    }
  ],
  publicDir: false,
  optimizeDeps: { include: ["@tauri-apps/api/path", "xlsx", "storybook/internal/router"] },
  test: {
    name: "storybook",
    testTimeout: 30_000,
    maxWorkers: 4,
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { channel: process.env.STORYBOOK_BROWSER_CHANNEL } }),
      headless: true,
      instances: [{ browser: "chromium" }]
    }
  }
})
