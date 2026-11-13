import { expect, test } from "bun:test"

test("bundled plugin assets are accessible from both Codex catalog locations", async () => {
  const config = await Bun.file(new URL("../../../src-tauri/tauri.conf.json", import.meta.url)).json()
  const scope: string[] = config.app.security.assetProtocol.scope
  // Tauri requires literal hidden path segments; .codex/** alone skips its .tmp directory.
  expect(scope).toContain("$HOME/.codex/.tmp/bundled-marketplaces/**")
  const allowed = (path: string) => scope.some((pattern) => new Bun.Glob(pattern).match(path))
  expect(allowed("$HOME/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/browser/assets/browser.png")).toBe(true)
  expect(
    allowed(
      "$HOME/.cache/codex-runtimes/codex-primary-runtime/plugins/openai-primary-runtime/plugins/documents/assets/logo.png"
    )
  ).toBe(true)
  expect(allowed("$HOME/.cache/codex-runtimes/codex-primary-runtime/auth.json")).toBe(false)
  expect(allowed("$HOME/.cache/unrelated/logo.png")).toBe(false)
})
