import path from "node:path"

import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"

const boundaries = {
  "lib/client": "client.ts",
  "features/appearance/wallpaper/controller": "wallpaper.ts",
  "lib/chat-window": "chat-window.ts",
  "features/vibemon/window-client": "pet-window.ts",
  "lib/runtime": "runtime.ts",
  "lib/settings-bridge": "settings-bridge.ts",
  "features/auth/store": "auth.ts",
  "features/extensions/runtime": "extensions.ts",
  "features/drive/controller": "drive.ts",
  "features/workspace/html-preview": "html-preview.ts"
}

const config: StorybookConfig = {
  stories: ["./stories/page-boards/**/*.stories.tsx", "./stories/flows/**/*.stories.tsx"],
  docs: { defaultName: "说明文档" },
  staticDirs: [
    "../public",
    { from: "./assets", to: "/storybook-fixtures" },
    { from: "../node_modules/@alwith/module-auth/assets/pets", to: "/storybook-pets" }
  ],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: { builder: { viteConfigPath: path.resolve(import.meta.dirname, "vite.config.ts") } }
  },
  async viteFinal(config) {
    const { mergeConfig } = await import("vite")
    return mergeConfig(config, {
      define: {
        __ALWITH_APP_ENV__: JSON.stringify({
          apiBaseUrl: "https://api.example.test/service",
          webSsoBaseUrl: "https://example.test"
        })
      },
      server: { watch: { ignored: ["**/src-tauri/**", "**/storybook-static/**"] } },
      plugins: [
        {
          name: "storybook-host-boundaries",
          enforce: "pre",
          resolveId(source: string, importer: string | undefined) {
            if (source === "@alwith/module-voice/audio") return path.resolve(import.meta.dirname, "fixtures/voice.ts")
            const target = source.startsWith("@/")
              ? path.resolve(import.meta.dirname, "../src", source.slice(2))
              : source.startsWith(".") && importer
                ? path.resolve(path.dirname(importer.split("?")[0]!), source)
                : source
            for (const [module, fixture] of Object.entries(boundaries)) {
              const file = path.resolve(import.meta.dirname, "../src", module)
              if (target === file || target === `${file}.ts` || target === `${file}.tsx`) {
                const mock = path.resolve(import.meta.dirname, "fixtures", fixture)
                if (importer?.split("?")[0] === mock) return
                return mock
              }
            }
          }
        },
        tailwindcss()
      ],
      // Worker URLs must be transformed by Vite instead of dependency prebundling.
      optimizeDeps: {
        entries: [path.resolve(import.meta.dirname, "stories/**/*.stories.tsx")],
        exclude: ["@alwith/module-chat"],
        // The excluded module's CommonJS dependencies still need prebundling, as in vite.config.ts.
        include: [
          "@base-ui/react/radio",
          "@base-ui/react/radio-group",
          "diff2html",
          "diff2html/lib/types",
          "use-sync-external-store/shim",
          "use-sync-external-store/shim/with-selector"
        ]
      },
      resolve: {
        alias: {
          "@/lib/open": path.resolve(import.meta.dirname, "fixtures/open.ts"),
          "@": path.resolve(import.meta.dirname, "../src")
        },
        dedupe: ["react", "react-dom", "@base-ui/react"]
      },
      envPrefix: "STORYBOOK_PUBLIC_"
    })
  }
}

export default config
