import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type UserConfig } from "vite"

import { productionJsxGuard } from "./scripts/lib/production-jsx.ts"

const host = process.env.TAURI_DEV_HOST
const debug = process.env.TAURI_ENV_DEBUG === "true"

export const config = (): UserConfig => ({
  plugins: [react(), tailwindcss(), productionJsxGuard()],
  resolve: {
    dedupe: ["react", "react-dom", "@base-ui/react"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src")
    }
  },
  // Local tarballs change during module development. Serve these ESM packages
  // directly so dependency optimization cannot retain an older JS implementation.
  optimizeDeps: {
    exclude: [
      "@alwith/module-chat",
      "@alwith/module-gamepad",
      "@alwith/module-fs",
      "@alwith/module-file-tree",
      "@alwith/module-editor",
      "@alwith/module-drive",
      "@alwith/module-auth"
    ],
    // Prebundle CommonJS dependencies of the excluded modules, including
    // the diff enum subpath and Milkdown's lazily loaded dependency graph.
    include: [
      "diff2html",
      "diff2html/lib/types",
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
      "@milkdown/core",
      "@milkdown/plugin-math",
      "@milkdown/plugin-history",
      "@milkdown/prose/state",
      "@milkdown/preset-commonmark",
      "@milkdown/preset-gfm",
      "@milkdown/utils"
    ]
  },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    license: { fileName: "THIRD_PARTY_LICENSES.txt" },
    target: "esnext",
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        chat: path.resolve(import.meta.dirname, "chat.html"),
        vibemon: path.resolve(import.meta.dirname, "vibemon.html"),
        vibemonBubble: path.resolve(import.meta.dirname, "vibemon-bubble.html"),
        gamepad: path.resolve(import.meta.dirname, "gamepad.html"),
        settings: path.resolve(import.meta.dirname, "settings.html"),
        guide: path.resolve(import.meta.dirname, "guide.html")
      }
    },
    minify: !debug,
    sourcemap: debug
  }
})

export default defineConfig(config)
