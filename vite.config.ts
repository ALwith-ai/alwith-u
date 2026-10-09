import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const host = process.env.TAURI_DEV_HOST
const debug = process.env.TAURI_ENV_DEBUG === "true"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom", "@base-ui/react"],
    alias: {
      "@": path.resolve(import.meta.dirname, "./src")
    }
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
    target: "esnext",
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        chat: path.resolve(import.meta.dirname, "chat.html"),
        settings: path.resolve(import.meta.dirname, "settings.html")
      }
    },
    minify: !debug,
    sourcemap: debug
  }
})
