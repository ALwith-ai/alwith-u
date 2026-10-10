import { afterEach, expect, test } from "vitest"
import { ResourceScope } from "@alwith/module-extension/host"
import { clearMocks, mockWindows } from "@tauri-apps/api/mocks"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { Toaster, toast } from "sonner"
import { commonCapabilities } from "../capabilities/common"
import { createLegacyHost } from "../legacy/host"
import { showExtensionLimitations } from "../legacy/limitations"

afterEach(() => {
  toast.dismiss()
  cleanup()
  clearMocks()
})

test("history failures surface once without a compatibility notice on opening or enabling", async () => {
  mockWindows("main")
  const scope = new ResourceScope()
  const manifest = {
    id: "yup-kb",
    name: "Knowledge",
    version: "1.0.0",
    manifestVersion: 3 as const,
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.10" },
    hosts: {},
    dataSchemaVersion: 1
  }
  const installation = {
    id: "yup-kb",
    installationId: "installation",
    enabled: true,
    packageRevision: "revision",
    dataGeneration: 1,
    source: "legacy:alwith-u",
    manifest
  }
  const provider = createLegacyHost(() => installation)
  const create = provider.create
  if (!create) throw new Error("Expected legacy host factory")
  const view = render(<Toaster />)
  try {
    await act(async () => {
      const host = create({ manifest, cancellation: scope.cancellation, own: dispose => scope.own(dispose) })
      await expect(
        host.invoke("list_sessions", { baseDir: "/__alwith_legacy/yup-kb/.alwith/projects" })
      ).rejects.toThrow("会话归档需要 codex-acp-v2")
      await expect(
        host.invoke("list_sessions", { baseDir: "/__alwith_legacy/yup-kb/.alwith/projects" })
      ).rejects.toThrow("会话归档需要 codex-acp-v2")
      await expect(
        host.invoke("plugin:fs|read_dir", { path: "/__alwith_legacy/yup-kb/.alwith/projects" })
      ).rejects.toThrow("会话归档需要 codex-acp-v2")
      await new Promise<void>(resolve => setTimeout(resolve, 20))
    })
    const archivalNotices = [...view.container.querySelectorAll("[data-sonner-toast]")].filter(notice =>
      notice.textContent?.includes("会话归档")
    )
    expect(archivalNotices).toHaveLength(1)
    await act(async () => {
      showExtensionLimitations({ ...installation, enabled: false })
      showExtensionLimitations({ ...installation, source: "local" })
      await new Promise<void>(resolve => setTimeout(resolve, 20))
    })
    expect(view.queryByText(/会话归档同步用户消息/)).toBeNull()
    await act(async () => {
      showExtensionLimitations(installation)
      showExtensionLimitations(installation)
      await new Promise<void>(resolve => setTimeout(resolve, 20))
    })
    expect(view.queryByText(/会话归档同步用户消息/)).toBeNull()
    expect(view.container.querySelectorAll("[data-sonner-toast]")).toHaveLength(1)
  } finally {
    await scope.dispose()
  }
})

test("extension notices remain manually dismissible after updating an indefinite notice", async () => {
  const scope = new ResourceScope()
  const notices = commonCapabilities.notices.create({
    cancellation: scope.cancellation,
    own: dispose => scope.own(dispose),
    manifest: {
      id: "notice-test",
      name: "Notice test",
      version: "1.0.0",
      manifestVersion: 3,
      entry: "main.js",
      dependencies: { "@alwith/module-extension": "^0.1.10" },
      hosts: {},
      dataSchemaVersion: 1
    }
  })
  const view = render(<Toaster />)
  try {
    await act(async () => {
      const notice = notices.show("Initial notice", 0)
      notice.setMessage("Updated notice")
      await new Promise<void>(resolve => setTimeout(resolve, 20))
    })
    expect(view.getByText("Updated notice")).toBeTruthy()
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Close toast" }))
      await new Promise<void>(resolve => setTimeout(resolve, 250))
    })
    expect(view.queryByText("Updated notice")).toBeNull()
  } finally {
    await scope.dispose()
  }
})
