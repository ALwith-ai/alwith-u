import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

// Same runner as Desktop and Board: vitest + jsdom + jest-dom. Vite options (plugins, dedupe,
// aliases) come from vite.config so tests resolve modules exactly like the app does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      server: {
        // Shared UI packages import CSS; Vite must transform these imports for Node tests.
        deps: { inline: ["@alwith/module-chat", "@alwith/module-editor", "@alwith/module-drive"] }
      },
      projects: [
        {
          // Component and browser-facing suites: a jsdom window per file, RTL cleanup after each test.
          test: {
            name: "frontend",
            environment: "jsdom",
            setupFiles: ["./vitest.setup.ts"],
            include: ["src/**/__tests__/*.test.{ts,tsx}"],
            exclude: ["**/node_modules/**", "**/dist/**", "src/agent/**", "src/core/**"]
          }
        },
        {
          // ACP engine suites talk to in-process fakes over Node streams; a DOM in scope breaks them.
          test: {
            name: "engine",
            environment: "node",
            setupFiles: ["./vitest.setup.ts"],
            include: ["src/{agent,core}/**/__tests__/*.test.ts"]
          }
        }
      ]
    }
  })
)
