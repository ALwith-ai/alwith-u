import { readdirSync } from "node:fs"
import path from "node:path"

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

// The shadcn plugin rewrites `@/components/ui/x` to package paths at transform time, which Vite's
// dependency scan cannot see. Prebundle every shipped module so a cold run never reloads mid-test.
const shadcnRoot = path.resolve(import.meta.dirname, "../node_modules/@nyssance/shadcn/dist/vega")
const shadcnModules = ["components/ui", "hooks", "lib"].flatMap((dir) =>
  readdirSync(path.join(shadcnRoot, dir))
    .filter((file) => file.endsWith(".js"))
    .map((file) => `@nyssance/shadcn/vega/${dir}/${file.slice(0, -3)}`)
)

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
  optimizeDeps: {
    include: [
      "@tauri-apps/api/path",
      "xlsx",
      "storybook/internal/router",
      "@agentclientprotocol/sdk/experimental/v2/unstable",
      "@alwith/module-store",
      "@alwith/module-store/tauri",
      "@nyssance/atlas/station",
      "@solar-icons/react/bold-duotone/chat-round-dots",
      "@solar-icons/react/bold-duotone/gamepad",
      "@solar-icons/react/bold-duotone/library",
      "@solar-icons/react/bold-duotone/settings",
      "@tauri-apps/plugin-global-shortcut",
      "@tauri-apps/plugin-notification",
      "@nyssance/shadcn > next-themes",
      "zustand/react/shallow",
      ...shadcnModules
    ]
  },
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
