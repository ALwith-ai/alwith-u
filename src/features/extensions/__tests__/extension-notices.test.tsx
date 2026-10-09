import { afterEach, expect, test } from "bun:test"
import { ResourceScope } from "@alwith/module-extension/host"
import { clearMocks, mockWindows } from "@tauri-apps/api/mocks"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { Toaster, toast } from "sonner"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { commonCapabilities } from "../capabilities/common"
import { createLegacyHost } from "../legacy/host"
import { showExtensionLimitations } from "../legacy/limitations"

installDom()
afterEach(() => {
  toast.dismiss()
  cleanup()
  clearMocks()
})

test("background activation stays quiet; explicit opening or enabling shows one closeable notice", async () => {
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
      await expect(host.invoke("list_sessions", {})).rejects.toThrow("会话归档暂不支持")
      await expect(host.invoke("list_sessions", {})).rejects.toThrow("会话归档暂不支持")
      await expect(
        host.invoke("plugin:fs|read_dir", { path: "/__alwith_legacy/yup-kb/.alwith/projects" })
      ).rejects.toThrow("会话归档暂不支持")
      await Bun.sleep(20)
    })
    const archivalNotices = [...view.container.querySelectorAll("[data-sonner-toast]")].filter(notice =>
      notice.textContent?.includes("会话归档")
    )
    expect(archivalNotices).toHaveLength(0)
    await act(async () => {
      showExtensionLimitations({ ...installation, enabled: false })
      showExtensionLimitations({ ...installation, source: "local" })
      await Bun.sleep(20)
    })
    expect(view.queryByText(/会话归档与会话关联不可用/)).toBeNull()
    await act(async () => {
      showExtensionLimitations(installation)
      showExtensionLimitations(installation)
      await Bun.sleep(20)
    })
    expect(view.getAllByText(/会话归档与会话关联不可用/)).toHaveLength(1)
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
      await Bun.sleep(20)
    })
    expect(view.getByText("Updated notice")).toBeTruthy()
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Close toast" }))
      await Bun.sleep(250)
    })
    expect(view.queryByText("Updated notice")).toBeNull()
  } finally {
    await scope.dispose()
  }
})
