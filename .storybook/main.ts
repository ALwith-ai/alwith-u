import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
  stories: ["./stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-themes", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/react-vite",
    options: { builder: { viteConfigPath: path.resolve(import.meta.dirname, "vite.config.ts") } }
  },
  async viteFinal(config) {
    const { mergeConfig } = await import("vite")
    return mergeConfig(config, {
      plugins: [tailwindcss()],
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
