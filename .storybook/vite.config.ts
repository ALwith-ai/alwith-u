import { defineConfig } from "vite"

// Keep the native application's entry points and environment out of previews.
export default defineConfig({ publicDir: false })
