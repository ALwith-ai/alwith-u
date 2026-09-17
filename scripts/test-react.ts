import { mock } from "bun:test"
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import * as React from "react"
import * as JSXRuntime from "react/jsx-runtime"
import * as JSXDevRuntime from "react/jsx-dev-runtime"

// Match Vite's React dedupe when testing locally linked React packages.
// No DOM installation here: browser globals remain isolated per test file.
const appRequire = createRequire(import.meta.url)
const chatRequire = createRequire(realpathSync(appRequire.resolve("@alwith/module-chat/virtualized-turn-list")))
// Alias to the real app exports, not fake hooks or a mocked renderer.
for (const [name, exports] of [
  ["react", React],
  ["react/jsx-runtime", JSXRuntime],
  ["react/jsx-dev-runtime", JSXDevRuntime]
] as const) {
  const sharedPath = chatRequire.resolve(name)
  if (sharedPath !== appRequire.resolve(name)) mock.module(sharedPath, () => exports)
}

// Base UI chooses a permanent no-op when imported before document exists.
// DOM suites install their browser per file, deliberately not in this preload.
// Use the real browser hook for those components, not a fake dialog/portal.
for (const require of [appRequire, chatRequire]) {
  const baseUiRequire = createRequire(require.resolve("@base-ui/react/dialog"))
  const layoutEffectPath = baseUiRequire.resolve("@base-ui/utils/useIsoLayoutEffect")
  for (const path of [layoutEffectPath, layoutEffectPath.replace(/\.js$/, ".mjs")]) {
    mock.module(path, () => ({ useIsoLayoutEffect: React.useLayoutEffect }))
  }
}
