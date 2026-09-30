import { expect, test } from "bun:test"
import { ResourceScope } from "@alwith/module-extension/host"
import { authorizeCapability, extensionActions } from "../policy"

test("operation policy follows native bundled provenance for any extension", (): void => {
  for (const id of ["second-extension", "alwith-static-wallpaper"]) {
    expect(extensionActions({ id, source: "bundled:alwith-u" })).toEqual({ update: false, uninstall: false })
    expect(extensionActions({ id, source: "local" })).toEqual({ update: true, uninstall: true })
    expect(extensionActions({ id, source: "bundled:other-app" })).toEqual({ update: true, uninstall: true })
  }
})

test("private capability grants require native bundled provenance and matching identity", async (): Promise<void> => {
  const scope = new ResourceScope()
  let source = "local"
  let calls = 0
  const provider = authorizeCapability(
    "test.native",
    {
      version: "1.0.0",
      create: () => {
        calls++
        return { ok: true }
      }
    },
    id => ({ id, source })
  )
  const manifest = {
    manifestVersion: 3,
    id: "second-extension",
    name: "Second",
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.0" },
    hosts: {},
    dataSchemaVersion: 1
  }
  const binding = { manifest, cancellation: scope.cancellation, own: scope.own.bind(scope) }
  if (!provider.create) throw new Error("Expected a scoped provider")
  expect(() => provider.create?.(binding)).toThrow("not authorized")
  expect(calls).toBe(0)
  source = "bundled:alwith-u"
  expect(provider.create(binding)).toEqual({ ok: true })
  expect(calls).toBe(1)
  expect(provider.create({ ...binding, manifest: { ...manifest, id: "another-bundled-extension" } })).toEqual({
    ok: true
  })
  const missing = authorizeCapability("test.native", { version: "1.0.0", value: {} }, () => undefined)
  expect(() => missing.create?.(binding)).toThrow("not authorized")
  const mismatch = authorizeCapability("test.native", { version: "1.0.0", value: {} }, () => ({ id: "other", source }))
  expect(() => mismatch.create?.(binding)).toThrow("not authorized")
  source = "bundled:other-app"
  expect(() => provider.create?.(binding)).toThrow("not authorized")
  await scope.dispose()
  source = "bundled:alwith-u"
  expect(() => provider.create?.(binding)).toThrow()
})
