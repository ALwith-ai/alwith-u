import type { ExtensionManifest } from "@alwith/module-extension"
import type { HostSnapshot } from "@alwith/module-extension/host"
import { act, fireEvent, render } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"
import { LeadingNavigation } from "@/features/layout/components/leading-navigation"
import { initI18n } from "@/lib/i18n"
import { ExtensionEntryMenu } from "../extension-entry-menu"
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
    dependencies: { "@alwith/module-extension": "^0.1.0" },
    hosts: {}
  }))
  return { host, manifests, run, onManage, onOpenSurface, onError }
}

test("entries from both placements open a menu without navigating, then open their targets", async () => {
  const props = fixture()
  const ui = render(
    <ExtensionEntryMenu
      {...props}
      trigger={
        <button type="button" onClick={props.onManage}>
          Extensions
        </button>
      }
    />
  )
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  expect(props.onManage).not.toHaveBeenCalled()
  expect(await ui.findByRole("menuitem", { name: "Runner app" })).toBeVisible()
  await act(async () => fireEvent.click(ui.getByRole("menuitem", { name: "Notes app" })))
  expect(props.onOpenSurface).toHaveBeenCalledWith("demo/page")
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  await act(async () => fireEvent.click(await ui.findByRole("menuitem", { name: "Runner app" })))
  expect(props.run).toHaveBeenCalledOnce()
})

test("no mounted actions navigates directly to management", () => {
  const props = fixture()
  props.host.actions = []
  const ui = render(
    <ExtensionEntryMenu
      {...props}
      trigger={
        <button type="button" onClick={props.onManage}>
          Extensions
        </button>
      }
    />
  )
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  expect(props.onManage).toHaveBeenCalledOnce()
  expect(ui.queryByRole("menu")).toBeNull()
})

test("unavailable targets are disabled, rejected commands report errors, and management stays accessible", async () => {
  const props = fixture()
  props.host.views = props.host.views.map(view => (view.extensionId === "demo" ? { ...view, id: "demo/other" } : view))
  const error = new Error("Failed")
  props.run.mockRejectedValue(error)
  const ui = render(
    <ExtensionEntryMenu
      {...props}
      trigger={
        <button type="button" onClick={props.onManage}>
          Extensions
        </button>
      }
    />
  )
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  expect(await ui.findByRole("menuitem", { name: "Notes app" })).toHaveAttribute("aria-disabled", "true")
  await act(async () => fireEvent.click(ui.getByRole("menuitem", { name: "Runner app" })))
  expect(props.onError).toHaveBeenCalledWith(error)
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  fireEvent.click(await ui.findByRole("menuitem", { name: "Manage app extensions" }))
  expect(props.onManage).toHaveBeenCalledOnce()
})

test("leading navigation goes directly to management", () => {
  const props = fixture()
  const ui = render(
    <LeadingNavigation
      activePage="plugins"
      onOpenVibemon={vi.fn()}
      onOpenPlugins={vi.fn()}
      onOpenExtensions={props.onManage}
    />
  )
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  expect(props.onManage).toHaveBeenCalledOnce()
  expect(ui.queryByRole("menu")).toBeNull()
})

test("an app mounted in both locations appears once using its localized name", async () => {
  const props = fixture()
  const action = props.host.actions[0]
  const manifest = props.manifests[0]
  if (!action || !manifest) throw new Error("Missing extension fixture")
  props.host.actions.push({ ...action, id: "demo/top", placement: "topBar" })
  manifest.locales = { en: { name: "Localized notes" } }
  const ui = render(
    <ExtensionEntryMenu
      {...props}
      trigger={
        <button type="button" onClick={props.onManage}>
          Extensions
        </button>
      }
    />
  )
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  expect(await ui.findAllByRole("menuitem", { name: "Localized notes" })).toHaveLength(1)
  expect(ui.queryByRole("menuitem", { name: "Open page" })).toBeNull()
})

test("both launchers show the same mounted apps and remove entries when their mount is removed", async () => {
  const props = fixture()
  const manifest = props.manifests[0]
  const action = props.host.actions[0]
  if (!manifest || !action) throw new Error("Missing extension fixture")
  props.manifests.push({ ...manifest, id: "background", name: "Background app" })
  props.host.commands.push({ id: "background/run", title: "Background command", run: vi.fn() })
  props.host.views.push({
    id: "background/page",
    extensionId: "background",
    title: "Background page",
    kind: "surfaces",
    mount: () => () => {}
  })
  props.host.actions.push({ ...action, id: "demo/top", placement: "topBar" })
  const launchers = () => (
    <>
      <ExtensionNavigation {...props} />
      <ExtensionEntryMenu {...props} trigger={<button type="button">Extensions</button>} />
    </>
  )
  const ui = render(launchers())
  expect(ui.getAllByRole("button").map(button => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
    "Notes app",
    "Runner app",
    "Extensions"
  ])
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  expect((await ui.findAllByRole("menuitem")).map(item => item.textContent)).toEqual([
    "Notes app",
    "Runner app",
    "Manage app extensions"
  ])
  props.host = { ...props.host, actions: [] }
  ui.rerender(launchers())
  expect(ui.queryByRole("separator")).toBeNull()
  expect(ui.queryByRole("menuitem")).toBeNull()
  expect(ui.getAllByRole("button")).toHaveLength(1)
})

test("both launchers require a content surface in addition to an entry mount", () => {
  const props = fixture()
  const launchers = () => (
    <>
      <ExtensionNavigation {...props} />
      <ExtensionEntryMenu {...props} trigger={<button type="button">Extensions</button>} />
    </>
  )
  const ui = render(launchers())
  expect(ui.getAllByRole("button")).toHaveLength(3)
  props.host = {
    ...props.host,
    views: props.host.views.map(view => ({ ...view, kind: "settingsPages" }))
  }
  ui.rerender(launchers())
  expect(ui.getAllByRole("button")).toHaveLength(1)
  expect(ui.queryByRole("separator")).toBeNull()
  fireEvent.click(ui.getByRole("button", { name: "Extensions" }))
  expect(ui.queryByRole("menu")).toBeNull()
})
