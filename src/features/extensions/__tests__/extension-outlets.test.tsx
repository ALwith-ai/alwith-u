import type { HostSnapshot, ViewContribution } from "@alwith/module-extension/host"
import { act, fireEvent, render } from "@testing-library/react"
import { beforeEach, expect, test } from "vitest"
import { initI18n } from "@/lib/i18n"
import {
  ExtensionActions,
  ExtensionSettingsContent,
  ExtensionSettingsNavigation,
  ExtensionStatusBar
} from "../extension-outlets"

beforeEach(async () => {
  await initI18n("en")
})
function view(id: string, kind: ViewContribution["kind"]): ViewContribution {
  return { id, kind, extensionId: "demo", title: id, mount: () => () => {} }
}
function snapshot(): HostSnapshot {
  return {
    instances: [],
    commands: [],
    views: [view("demo/page", "surfaces")],
    actions: [
      {
        id: "demo/open",
        extensionId: "demo",
        placement: "navigation",
        title: "Open page",
        target: { type: "surface", id: "demo/page" }
      },
      {
        id: "demo/run",
        extensionId: "demo",
        placement: "topBar",
        title: "Run command",
        icon: "play",
        target: { type: "command", id: "demo/run" }
      }
    ]
  }
}
test("navigation opens its own page, reflects selection and blocks missing targets", async () => {
  const host = snapshot(),
    opened: string[] = [],
    errors: unknown[] = []
  const props = {
    host,
    placement: "navigation" as const,
    activeView: "demo/page",
    onOpenSurface: (id: string): void => {
      opened.push(id)
    },
    onError: (error: unknown): void => {
      errors.push(error)
    }
  }
  const ui = render(<ExtensionActions {...props} />)
  expect(ui.getByRole("button", { name: "Open page" }).getAttribute("aria-current")).toBe("page")
  await act(async () => fireEvent.click(ui.getByRole("button", { name: "Open page" })))
  expect(opened).toEqual(["demo/page"])
  ui.rerender(<ExtensionActions {...props} host={{ ...host, views: [] }} />)
  expect((ui.getByRole("button", { name: "Open page" }) as HTMLButtonElement).disabled).toBe(true)
  ui.rerender(<ExtensionActions {...props} host={{ ...host, actions: [] }} />)
  expect(ui.queryByRole("button")).toBeNull()
  expect(errors).toEqual([])
})
test("top bar executes commands and reports rejected operations", async () => {
  const host = snapshot(),
    errors: unknown[] = []
  host.commands = [
    {
      id: "demo/run",
      title: "Run",
      run: async (): Promise<void> => {
        throw new Error("Command failed")
      }
    }
  ]
  const ui = render(
    <ExtensionActions
      host={host}
      placement="topBar"
      onOpenSurface={() => {
        throw new Error("Unexpected navigation")
      }}
      onError={error => {
        errors.push(error)
      }}
    />
  )
  await act(async () => fireEvent.click(ui.getByRole("button", { name: "Run command" })))
  expect(errors).toHaveLength(1)
  expect((errors[0] as Error).message).toBe("Command failed")
})
test("status outlets only mount status views and disappear when withdrawn", () => {
  const ui = render(
    <ExtensionStatusBar
      views={[view("demo/status", "statusBar"), view("demo/page", "surfaces")]}
      renderView={item => <span>{item.id}</span>}
    />
  )
  expect(ui.getByRole("region", { name: "Extension status bar" }).textContent).toBe("demo/status")
  expect(ui.queryByText("demo/page")).toBeNull()
  ui.rerender(<ExtensionStatusBar views={[]} renderView={item => <span>{item.id}</span>} />)
  expect(ui.queryByRole("region")).toBeNull()
})
test("settings columns select full pages and show unavailable after withdrawal", async () => {
  const page = view("demo/preferences", "settingsPages"),
    selected: string[] = []
  const ui = render(
    <>
      <ExtensionSettingsNavigation
        views={[page, view("demo/inline", "settings")]}
        activeId={page.id}
        onSelect={id => {
          selected.push(id)
        }}
      />
      <ExtensionSettingsContent id={page.id} views={[page]} renderView={item => <div>Content of {item.id}</div>} />
    </>
  )
  await act(async () => fireEvent.click(ui.getByRole("button", { name: page.title })))
  expect(selected).toEqual([page.id])
  expect(ui.queryByRole("button", { name: "demo/inline" })).toBeNull()
  expect(ui.getByText(`Content of ${page.id}`)).toBeTruthy()
  ui.rerender(<ExtensionSettingsContent id={page.id} views={[]} renderView={() => <div>Stale content</div>} />)
  expect(ui.queryByText("Stale content")).toBeNull()
  expect(ui.getByText("Extension page unavailable")).toBeTruthy()
})

test("top bar defaults to left while preserving explicit center/right and sorting", () => {
  const host = snapshot()
  const action = host.actions[1]
  if (!action) throw new Error("Missing fixture")
  host.actions = [
    { ...action, id: "demo/right", title: "Right", alignment: "right", order: 20 },
    { ...action, id: "demo/left-last", title: "Left last", alignment: "left", order: 20 },
    { ...action, id: "demo/legacy", title: "Legacy", order: 10 },
    { ...action, id: "demo/center", title: "Center", alignment: "center" },
    { ...action, id: "demo/left-first", title: "Left first", alignment: "left", order: 10 }
  ]
  const ui = render(<ExtensionActions host={host} placement="topBar" onOpenSurface={() => {}} onError={() => {}} />)
  const labels = (side: string): (string | null)[] =>
    Array.from(ui.container.querySelectorAll(`[data-extension-alignment="${side}"] button`), item =>
      item.getAttribute("aria-label")
    )
  expect(labels("left")).toEqual(["Left first", "Legacy", "Left last"])
  expect(labels("center")).toEqual(["Center"])
  expect(labels("right")).toEqual(["Right"])
})
test("status bar partitions widgets and preserves the legacy left default", () => {
  const ui = render(
    <ExtensionStatusBar
      views={[
        { ...view("demo/right", "statusBar"), alignment: "right" },
        { ...view("demo/center", "statusBar"), alignment: "center" },
        { ...view("demo/left-last", "statusBar"), alignment: "left", order: 20 },
        { ...view("demo/legacy", "statusBar"), order: 10 }
      ]}
      renderView={item => <span>{item.id}</span>}
    />
  )
  expect(ui.container.querySelector('[data-extension-alignment="left"]')?.textContent).toBe("demo/legacydemo/left-last")
  expect(ui.container.querySelector('[data-extension-alignment="center"]')?.textContent).toBe("demo/center")
  expect(ui.container.querySelector('[data-extension-alignment="right"]')?.textContent).toBe("demo/right")
})

test("business ribbon entries render distinct Lucide icons on the left", () => {
  const host = snapshot()
  const action = host.actions[1]
  if (!action) throw new Error("Missing fixture")
  const icons = [
    ["bar-chart-3", "lucide-chart-column"],
    ["file-text", "lucide-file-text"],
    ["book-open", "lucide-book-open"],
    ["shield-check", "lucide-shield-check"]
  ] as const
  host.actions = icons.map(([icon]) => ({ ...action, id: `demo/${icon}`, title: icon, icon }))
  const ui = render(<ExtensionActions host={host} placement="topBar" onOpenSurface={() => {}} onError={() => {}} />)
  for (const [name, svgClass] of icons) {
    const button = ui.getByRole("button", { name })
    expect(button.closest("[data-extension-alignment]")?.getAttribute("data-extension-alignment")).toBe("left")
    expect(button.querySelector(`svg.${svgClass}`)).not.toBeNull()
  }
})
