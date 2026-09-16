import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const host = process.env.TAURI_DEV_HOST

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
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        settings: path.resolve(import.meta.dirname, "settings.html")
      }
    },
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
})
