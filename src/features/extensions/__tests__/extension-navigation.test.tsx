import type { ExtensionManifest } from "@alwith/module-extension"
import type { HostSnapshot } from "@alwith/module-extension/host"
import { act, fireEvent, render } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"
import { initI18n } from "@/lib/i18n"
import { ExtensionNavigation } from "../extension-navigation"

beforeEach(async () => {
  await initI18n("en")
})

function fixture() {
  const run = vi.fn()
  const host: HostSnapshot = {
    instances: [],
    commands: [{ id: "runner/run", title: "Run", run }],
    views: [
      { id: "notes/page", extensionId: "notes", title: "Page", kind: "surfaces", mount: () => () => {} },
      { id: "runner/page", extensionId: "runner", title: "Runner", kind: "surfaces", mount: () => () => {} }
    ],
    actions: [
      {
        id: "notes/open",
        extensionId: "notes",
        title: "Open page",
        placement: "navigation",
        target: { type: "surface", id: "notes/page" }
      },
      {
        id: "notes/top",
        extensionId: "notes",
        title: "Open page",
        placement: "topBar",
        target: { type: "surface", id: "notes/page" }
      },
      {
        id: "runner/run",
        extensionId: "runner",
        title: "Run",
        placement: "topBar",
        target: { type: "command", id: "runner/run" }
      }
    ]
  }
  const manifests: ExtensionManifest[] = ["notes", "runner"].map(id => ({
    id,
    name: `${id} app`,
    version: "1.0.0",
    manifestVersion: 3,
    entry: "main.js",
    dataSchemaVersion: 1,
    dependencies: { "@alwith/module-extension": "^0.1.0" },
    hosts: {}
  }))
  return { host, manifests, run, onOpenSurface: vi.fn(), onError: vi.fn() }
}

test("deduplicates extension apps, exposes selection, and opens the declared targets", async () => {
  const props = fixture()
  const ui = render(<ExtensionNavigation {...props} activeView="notes/page" />)
  expect(ui.getAllByRole("button")).toHaveLength(2)
  expect(ui.getByRole("separator")).toBeInTheDocument()
  expect(ui.getByRole("button", { name: "notes app" })).toHaveAttribute("aria-current", "page")
  await act(async () => fireEvent.click(ui.getByRole("button", { name: "notes app" })))
  expect(props.onOpenSurface).toHaveBeenCalledExactlyOnceWith("notes/page")
  await act(async () => fireEvent.click(ui.getByRole("button", { name: "runner app" })))
  expect(props.run).toHaveBeenCalledOnce()
})

test("removes the separator and list when extension actions are removed", () => {
  const props = fixture()
  const ui = render(<ExtensionNavigation {...props} />)
  ui.rerender(<ExtensionNavigation {...props} host={{ ...props.host, actions: [] }} />)
  expect(ui.queryByRole("separator")).not.toBeInTheDocument()
  expect(ui.queryByRole("button")).not.toBeInTheDocument()
})

test("unavailable targets are disabled and rejected commands report an error", async () => {
  const props = fixture()
  props.host.views = props.host.views.map(view =>
    view.extensionId === "notes" ? { ...view, id: "notes/other" } : view
  )
  const error = new Error("Unavailable")
  props.run.mockRejectedValue(error)
  const ui = render(<ExtensionNavigation {...props} />)
  expect(ui.getByRole("button", { name: "notes app" })).toBeDisabled()
  await act(async () => fireEvent.click(ui.getByRole("button", { name: "runner app" })))
  expect(props.onError).toHaveBeenCalledExactlyOnceWith(error)
})
