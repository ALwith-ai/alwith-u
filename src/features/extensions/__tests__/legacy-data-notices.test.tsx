import { extensionApiVersion, type ExtensionManifest } from "@alwith/module-extension"
import { ExtensionHost } from "@alwith/module-extension/host"
import { createMemoryData } from "@alwith/module-extension/testing"
import { emit } from "@tauri-apps/api/event"
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { toast, Toaster } from "sonner"
import { afterEach, expect, test, vi } from "vitest"

import { createLegacyHost } from "../legacy/host"
import { legacyModule } from "../legacy/module"

afterEach(() => {
  cleanup()
  toast.dismiss()
  clearMocks()
})

test("one invalidation surfaces readable native errors from three plugins and the BI projection", async () => {
  mockWindows("main")
  const ipc = vi.fn()
  mockIPC(ipc, { shouldMockEvents: true })
  const view = render(<Toaster />)
  const changed = new Set<() => void>()
  const message = "instance is revoked or belongs to another window"
  const source = 'module.exports = class extends require("@alwith/extension").Plugin {}'
  const manifests: ExtensionManifest[] = ["bi-metrics", "etms-strategy-review", "etms-strategy-compose"].map((id) => ({
    manifestVersion: 3,
    id,
    name: id,
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.6.0" },
    hosts: {},
    dataSchemaVersion: 1
  }))
  const provider = createLegacyHost((id) => {
    const manifest = manifests.find((item) => item.id === id)
    return (
      manifest && {
        id,
        manifest,
        source: "legacy:alwith-u",
        installationId: id,
        enabled: true,
        packageRevision: "one",
        dataGeneration: 1
      }
    )
  })
  const host = new ExtensionHost({
    apiVersion: extensionApiVersion,
    capabilities: { "legacy.host": provider },
    contributions: {}
  })
  const data = createMemoryData()
  const read = vi.fn(data.read)
  try {
    for (const manifest of manifests)
      await host.activate(manifest, "one", (ctx) => legacyModule.createLegacyExtension(ctx, { manifest, source }), {
        data: {
          ...data,
          read,
          subscribe(listener) {
            changed.add(listener)
            return () => {
              changed.delete(listener)
            }
          }
        },
        resource: (path) => path
      })
    await waitFor(() => expect(ipc).toHaveBeenCalledWith("legacy_share_business", expect.anything()))
    read.mockRejectedValue({ code: "staleToken", message })
    await act(async () => {
      for (const listener of changed) listener()
      await emit("extension://changed", {})
    })
    await waitFor(() => expect(view.getAllByText(message)).toHaveLength(3))
    expect(view.getByText(`业务技能数据共享失败：${message}`)).toBeTruthy()
    expect(view.container.querySelectorAll('[data-sonner-toast][data-visible="true"]')).toHaveLength(3)
    expect(view.queryByText(/\[object Object\]/)).toBeNull()
  } finally {
    await host.dispose()
  }
})
