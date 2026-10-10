import { expect, test } from "bun:test"

type Permission = string | { identifier: string; allow?: Array<{ path?: string }> }

test("chat windows can open generated images through the hidden Codex directory", async () => {
  const capability = (await Bun.file(
    new URL("../../../src-tauri/capabilities/default.json", import.meta.url)
  ).json()) as {
    windows: string[]
    permissions: Permission[]
  }
  expect(capability.windows).toContain("main")
  expect(capability.windows).toContain("chat")
  const paths = capability.permissions.flatMap(permission =>
    typeof permission !== "string" && permission.identifier === "opener:allow-open-path"
      ? (permission.allow?.map(entry => entry.path) ?? [])
      : []
  )
  // Tauri's default leading-dot rule makes the general ** scope skip .codex.
  expect(paths).toContain("$HOME/.codex/generated_images/**")
  expect(paths).not.toContain("$HOME/.codex/**")
})
