import { type DataSnapshot, type ExtensionContext, parseManifest } from "@alwith/module-extension"
import { ExtensionHost } from "@alwith/module-extension/host"
import { createMemoryData } from "@alwith/module-extension/testing"
import { expect, test, vi } from "vitest"

import { extensionApiSupport } from "../api-support"

function host(): ExtensionHost {
  return new ExtensionHost({
    ...extensionApiSupport,
    host: { id: "alwith-u", version: "0.2.23" },
    capabilities: {},
    contributions: {}
  })
}

function manifest(id: string, range: string) {
  return parseManifest({
    id,
    name: id,
    version: "1.0.0",
    dependencies: { "@alwith/module-extension": range },
    hosts: { "alwith-u": "^0.2.0" }
  })
}

test.each([
  ["bi-metrics", "^0.1.0-rc.11"],
  ["etms-strategy-review", "^0.1.0-rc.11"],
  ["yup-kb", "^0.1.0-rc.11"],
  ["new-extension", "^0.5.0"]
])("%s activates and reloads with its original manifest, revision and user data", async (id, range) => {
  const app = host()
  const selected = manifest(id, range)
  const originalManifest = structuredClone(selected)
  const revision = `immutable-${id}`
  const initial: DataSnapshot = {
    generation: 4,
    revision: 8,
    schemaVersion: 1,
    value: { userEdited: id }
  }
  const data = createMemoryData(initial)
  const write = vi.spyOn(data, "write")
  const read = vi.fn()
  const factory = (context: ExtensionContext) => ({
    async onload() {
      read(await context.data.read())
      expect(context.manifest).toEqual(originalManifest)
    }
  })
  try {
    await app.activate(selected, revision, factory, { data, resource: (path) => path })
    expect(app.snapshot().instances).toEqual([{ id, revision, status: "active", errors: [] }])
    await app.deactivate(id)
    await app.activate(selected, revision, factory, { data, resource: (path) => path })
    expect(app.snapshot().instances).toEqual([{ id, revision, status: "active", errors: [] }])
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenNthCalledWith(1, initial)
    expect(read).toHaveBeenNthCalledWith(2, initial)
    expect(write).not.toHaveBeenCalled()
    expect(await data.read()).toEqual(initial)
    expect(selected).toEqual(originalManifest)
  } finally {
    await app.dispose()
  }
})

test.each(["^0.1.0-rc.21", "^0.1.0", "^0.2.0"])(
  "U rejects unsupported extension API range %s before executing its factory",
  async (range) => {
    const app = host()
    const factory = vi.fn(() => ({}))
    try {
      await expect(app.activate(manifest("unsupported", range), "existing-revision", factory)).rejects.toThrow(
        "@alwith/module-extension requires"
      )
      expect(factory).not.toHaveBeenCalled()
    } finally {
      await app.dispose()
    }
  }
)

test("the compatible SDK does not bypass an extension's host constraint", async () => {
  const app = host()
  const selected = manifest("unsupported-host", "^0.1.0-rc.11")
  selected.hosts["alwith-u"] = "^9.0.0"
  const factory = vi.fn(() => ({}))
  try {
    await expect(app.activate(selected, "existing-revision", factory)).rejects.toThrow(
      "host alwith-u requires ^9.0.0; available 0.2.23"
    )
    expect(factory).not.toHaveBeenCalled()
  } finally {
    await app.dispose()
  }
})
