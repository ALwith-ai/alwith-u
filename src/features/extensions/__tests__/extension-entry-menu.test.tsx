import type { ExtensionManifest } from "@alwith/module-extension"
import type { HostSnapshot } from "@alwith/module-extension/host"
import { fireEvent, render } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

import { LeadingNavigation } from "@/features/layout/components/leading-navigation"
import { initI18n } from "@/lib/i18n"

import { ExtensionNavigation } from "../extension-navigation"

beforeEach(async () => {
  await initI18n("en")
})

function fixture() {
  const onManage = vi.fn(),
    onOpenSurface = vi.fn(),
    onError = vi.fn()
  const run = vi.fn()
  const host: HostSnapshot = {
    instances: [],
    commands: [{ id: "runner/run", title: "Run", run }],
    views: [
      { id: "demo/page", extensionId: "demo", title: "Page", kind: "surfaces", mount: () => () => {} },
      { id: "runner/page", extensionId: "runner", title: "Runner", kind: "surfaces", mount: () => () => {} }
    ],
    actions: [
      {
        id: "demo/open",
        extensionId: "demo",
        placement: "navigation",
        title: "Open page",
        target: { type: "surface", id: "demo/page" }
      },
      {
        id: "runner/run",
        extensionId: "runner",
        placement: "topBar",
        title: "Run command",
        target: { type: "command", id: "runner/run" }
      }
    ]
  }
  const manifests: ExtensionManifest[] = (
    [
      ["demo", "Notes app"],
      ["runner", "Runner app"]
    ] as const
  ).map(([id, name]) => ({
    id,
    name,
    version: "1.0.0",
    manifestVersion: 3,
    entry: "main.js",
    dataSchemaVersion: 1,
    dependencies: { "@alwith/module-extension": "^0.5.0" },
    hosts: {}
  }))
  return { host, manifests, run, onManage, onOpenSurface, onError }
}

test("leading navigation opens customization without a standalone extension entry", () => {
  const open = vi.fn()
  const ui = render(
    <LeadingNavigation activePage="extensions" onOpenVibemon={vi.fn()} onOpenArchives={vi.fn()} onOpenPlugins={open} />
  )
  expect(ui.queryByRole("button", { name: "Extensions" })).toBeNull()
  expect(ui.getByRole("button", { name: "Toolbox" })).toHaveAttribute("aria-current", "page")
  fireEvent.click(ui.getByRole("button", { name: "Toolbox" }))
  expect(open).toHaveBeenCalledOnce()
})

test("navigation removes app entries when their mounts are removed", () => {
  const props = fixture()
  const ui = render(<ExtensionNavigation {...props} />)
  expect(ui.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
    "Notes app",
    "Runner app"
  ])
  props.host = { ...props.host, actions: [] }
  ui.rerender(<ExtensionNavigation {...props} />)
  expect(ui.queryAllByRole("button")).toHaveLength(0)
})

test("navigation requires a content surface in addition to an entry mount", () => {
  const props = fixture()
  const ui = render(<ExtensionNavigation {...props} />)
  expect(ui.getAllByRole("button")).toHaveLength(2)
  props.host = { ...props.host, views: props.host.views.map((view) => ({ ...view, kind: "settingsPages" })) }
  ui.rerender(<ExtensionNavigation {...props} />)
  expect(ui.queryAllByRole("button")).toHaveLength(0)
})
