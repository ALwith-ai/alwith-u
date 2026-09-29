import { act, fireEvent, render } from "@testing-library/react"
import { beforeEach, expect, test } from "bun:test"
import { ExtensionHost } from "@alwith/module-extension/host"
import { mountReact } from "@alwith/module-extension/react"
import type { ExtensionManifest } from "@alwith/module-extension"
import type { ReactNode } from "react"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { initI18n } from "@/lib/i18n"
import { ExtensionViewContent } from "../extension-view"

installDom()
beforeEach(async () => {
  await initI18n("en")
})

test("a failed extension view shows a local error and retry recreates its content", async () => {
  const host = new ExtensionHost({ apiVersion: "0.1.0", capabilities: {}, contributions: { surfaces: "1.0.0" } })
  const manifest: ExtensionManifest = {
    manifestVersion: 3,
    id: "broken",
    name: "Broken",
    version: "1.0.0",
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.0" },
    hosts: {},
    dataSchemaVersion: 1
  }
  let broken = true
  function Content(): ReactNode {
    if (broken) throw new Error("view failed")
    return <span>Recovered view</span>
  }
  await host.activate(manifest, "one", context => {
    context.view("surfaces", mountReact({ id: "page", title: "Page", render: () => <Content /> }))
    return {}
  })
  const errors: unknown[] = []
  const ui = render(<ExtensionViewContent host={host} id="broken/page" onError={error => errors.push(error)} />)
  try {
    await act(async () => {})
    expect(ui.getByRole("alert").textContent).toContain("view failed")
    expect(errors).toHaveLength(1)
    expect(host.snapshot().instances[0]?.status).toBe("active")
    broken = false
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Retry" }))
    })
    expect(ui.queryByRole("alert")).toBeNull()
    expect(ui.getByText("Recovered view")).toBeTruthy()
  } finally {
    await act(async () => {
      ui.unmount()
      await host.dispose()
    })
  }
})
