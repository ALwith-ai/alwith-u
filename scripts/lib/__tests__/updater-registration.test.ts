import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("the host registers the configured updater before the shell on both backends", () => {
  const source = readFileSync(new URL("../../../src-tauri/src/lib.rs", import.meta.url), "utf8")
  const registration = source.indexOf("builder.plugin(tauri_plugin_updater::Builder::new().build())")
  const shell = source.indexOf(".plugin(alwith_desktop_shell::init_with_options(")
  expect(registration).toBeGreaterThan(-1)
  expect(registration).toBeLessThan(shell)
  const official = source.slice(source.indexOf("// Official plugins"), source.indexOf("// Non-official plugins"))
  const names = [...official.matchAll(/tauri_plugin_(\w+)::(?:init|Builder)/g)].map((match) => match[1])
  expect(names[0]).toBe("single_instance")
  expect(names.slice(1)).toEqual([...names.slice(1)].sort())
  expect(source).toContain(`let builder = if alwith_desktop_shell::updates_configured(context.config()) {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };`)
})
