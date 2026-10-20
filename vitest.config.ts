import { defineConfig, mergeConfig } from "vitest/config"

import { config as viteConfig } from "./vite.config.ts"

// Same runner as Desktop and Board: vitest + jsdom + jest-dom. Vite options (plugins, dedupe,
// aliases) come from vite.config so tests resolve modules exactly like the app does.
export default mergeConfig(
  viteConfig(),
  defineConfig({
    test: {
      globals: true,
      // Leave CPU headroom for jsdom so concurrent component suites keep responsive timers.
      maxWorkers: "50%",
      // Browser storage belongs to each jsdom window, not Node's process-global Web Storage.
      execArgv: ["--no-experimental-webstorage"],
      server: {
        // Shared UI packages import CSS; Vite must transform these imports for Node tests.
        deps: {
          inline: [
            "@alwith/module-gamepad",
            "@alwith/module-auth",
            "@alwith/module-chat",
            "@alwith/module-editor",
            "@alwith/module-drive"
          ]
        }
      },
      projects: [
        {
          // Component and browser-facing suites: a jsdom window per file, RTL cleanup after each test.
          test: {
            name: "frontend",
            environment: "jsdom",
            setupFiles: ["./vitest.setup.ts"],
            include: ["src/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
            exclude: ["**/node_modules/**", "**/dist/**", "src/agent/**", "src/core/**"]
          }
        },
        {
          // ACP engine suites talk to in-process fakes over Node streams; a DOM in scope breaks them.
          test: {
            name: "engine",
            environment: "node",
            setupFiles: ["./vitest.setup.ts"],
            include: ["src/{agent,core}/**/__tests__/**/*.{test,spec}.ts"]
          }
        }
      ]
    }
  })
)
