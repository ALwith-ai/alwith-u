import type { HostSnapshot, RuntimeSnapshot, ViewContribution } from "@alwith/module-extension/host"
import type { Installation, Request } from "@alwith/module-extension/tauri"
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test } from "vitest"
import i18n, { initI18n } from "@/lib/i18n"
import { ExtensionsManager } from "../extensions-manager"

beforeEach(async () => {
  await initI18n("en")
})
afterEach(async () => {
  await act(async () => {
    cleanup()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
function installation(id: string, name: string): Installation {
  return {
    id,
    installationId: id,
    enabled: true,
    packageRevision: "revision",
    dataGeneration: 1,
    source: "local",
    manifest: {
      id,
      name,
      version: "1.0.0",
      manifestVersion: 3,
      entry: "main.js",
      dataSchemaVersion: 1,
      dependencies: { "@alwith/module-extension": "^0.1.0" },
      hosts: {}
    }
  }
}
const host: HostSnapshot = {
  actions: [],
  commands: [],
  views: [],
  instances: [{ id: "alpha", revision: "revision", status: "active", errors: [] }]
}
function state(): RuntimeSnapshot & { native: NonNullable<RuntimeSnapshot["native"]> } {
  return {
    busy: false,
    errors: {},
    native: {
      protocolVersion: 1,
      serviceId: "test",
      sequence: 1,
      pending: [],
      installations: [installation("alpha", "Alpha Notes"), installation("beta", "Beta Timer")]
    }
  }
}
function setup(
  snapshot: RuntimeSnapshot = state(),
  busy = false,
  contributions: HostSnapshot = host,
  navigation = true
) {
  const actions: unknown[] = []
  const view = render(
    <ExtensionsManager
      state={snapshot}
      host={contributions}
      busy={busy}
      onInstall={(id?: string): void => {
        actions.push({ install: id ?? null })
      }}
      onRequest={(request: Request): void => {
        actions.push(request)
      }}
      onUninstall={(id: string, name: string): void => {
        actions.push({ uninstall: id, name })
      }}
      onOpenSurface={
        navigation
          ? (id: string): void => {
              actions.push({ surface: id })
            }
          : undefined
      }
      renderSettings={() => null}
    />
  )
  return { ...view, actions }
}

function surface(extensionId: string, id: string, title: string): ViewContribution {
  return { extensionId, id, title, kind: "surfaces", mount: () => () => {} }
}

test("extension menu opens only its own contributed surface with the exact view identity", async (): Promise<void> => {
  const contributions: HostSnapshot = {
    ...host,
    views: [
      surface("alpha", "alpha/vivarium-notes", "个人笔记"),
      surface("beta", "beta/vivarium-timer", "Timer workspace"),
      { ...surface("alpha", "alpha/preferences", "Preferences"), kind: "settings" }
    ]
  }
  const view = setup(state(), false, contributions)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "More actions for Alpha Notes" })))
  expect(view.queryByRole("menuitem", { name: "Timer workspace" })).toBeNull()
  expect(view.queryByRole("menuitem", { name: "Preferences" })).toBeNull()
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "个人笔记" })))
  expect(view.actions).toEqual([{ surface: "alpha/vivarium-notes" }])
})

test("bundled extensions expose contributed pages without update or uninstall actions", async (): Promise<void> => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  item.source = "bundled:alwith-u"
  snapshot.native.installations[0] = item
  const view = setup(snapshot, false, { ...host, views: [surface("alpha", "alpha/page", "Notes workspace")] })
  await act(async () => fireEvent.click(view.getByRole("button", { name: "More actions for Alpha Notes" })))
  expect(view.queryByRole("menuitem", { name: "Update from folder" })).toBeNull()
  expect(view.queryByRole("menuitem", { name: "Uninstall" })).toBeNull()
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "Notes workspace" })))
  expect(view.actions).toEqual([{ surface: "alpha/page" }])
})

test.each(["disabled", "error"])("%s extensions cannot open retained surface contributions", async reason => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  snapshot.native.installations[0] = item
  if (reason === "disabled") item.enabled = false
  else snapshot.errors.alpha = "Activation failed"
  const view = setup(snapshot, false, { ...host, views: [surface("alpha", "alpha/page", "Notes workspace")] })
  await act(async () => fireEvent.click(view.getByRole("button", { name: "More actions for Alpha Notes" })))
  const page = view.getByRole("menuitem", { name: "Notes workspace" })
  expect(page.getAttribute("aria-disabled")).toBe("true")
  await act(async () => fireEvent.click(page))
  expect(view.actions).toEqual([])
})

test.each(["busy", "pending"])("%s extensions cannot open their surface menu", async reason => {
  const snapshot = state()
  if (reason === "pending") snapshot.native.pending = [{ id: "alpha", action: "disable", waitingInstances: 1 }]
  const view = setup(snapshot, reason === "busy", {
    ...host,
    views: [surface("alpha", "alpha/page", "Notes workspace")]
  })
  const trigger = view.getByRole("button", { name: "More actions for Alpha Notes" }) as HTMLButtonElement
  expect(trigger.disabled).toBe(true)
  await act(async () => fireEvent.click(trigger))
  expect(view.queryByRole("menuitem", { name: "Notes workspace" })).toBeNull()
  expect(view.actions).toEqual([])
})

test("settings windows omit surface navigation when no host callback is provided", async (): Promise<void> => {
  const view = setup(state(), false, { ...host, views: [surface("alpha", "alpha/page", "Notes workspace")] }, false)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "More actions for Alpha Notes" })))
  expect(view.queryByRole("menuitem", { name: "Notes workspace" })).toBeNull()
  expect(view.getByRole("menuitem", { name: "Uninstall" })).toBeTruthy()
})

test("extension manager shows installed data directly, searches and supports local installation", async () => {
  const view = setup()
  expect(view.getByRole("heading", { name: "Extensions" })).toBeTruthy()
  expect(view.getByText("BETA")).toBeTruthy()
  expect(view.queryByRole("tablist")).toBeNull()
  expect(view.getByText("Alpha Notes")).toBeTruthy()
  expect(view.getByText("Beta Timer")).toBeTruthy()
  await act(async () => {
    const input = view.getByRole("searchbox")
    input.focus()
    fireEvent.input(input, { target: { value: " ALPHA " } })
    fireEvent.keyUp(input, { key: "a" })
  })
  expect(view.getByText("Alpha Notes")).toBeTruthy()
  expect(view.queryByText("Beta Timer")).toBeNull()
  await act(async () => {
    const input = view.getByRole("searchbox")
    input.focus()
    fireEvent.input(input, { target: { value: "missing" } })
    fireEvent.keyUp(input, { key: "a" })
  })
  expect(view.getByText("No matching extensions.")).toBeTruthy()
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Install from folder" })))
  expect(view.actions).toEqual([{ install: null }])
})

test("installed row forwards toggle, folder update and uninstall with the correct identity", async () => {
  const view = setup()
  const row = within(view.getByRole("region", { name: "Alpha Notes" }))
  await act(async () => fireEvent.click(row.getByRole("switch", { name: "Enable Alpha Notes" })))
  expect(view.actions[0]).toEqual({ type: "beginTransition", id: "alpha", action: "disable" })
  await act(async () => fireEvent.click(row.getByRole("button", { name: "More actions for Alpha Notes" })))
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "Update from folder" })))
  expect(view.actions[1]).toEqual({ install: "alpha" })
  await act(async () => fireEvent.click(row.getByRole("button", { name: "More actions for Alpha Notes" })))
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "Uninstall" })))
  expect(view.actions[2]).toEqual({ uninstall: "alpha", name: "Alpha Notes" })
})

test("pending transitions remain cancellable while errors and blocked controls stay visible", async () => {
  const snapshot = state()
  snapshot.native.pending = [{ id: "alpha", action: "disable", waitingInstances: 2 }]
  snapshot.errors.alpha = "Cleanup failed"
  const view = setup(snapshot)
  const row = within(view.getByRole("region", { name: "Alpha Notes" }))
  expect(row.getByText(/Waiting for 2 windows to stop/)).toBeTruthy()
  expect(row.getByRole("alert").textContent).toContain("Cleanup failed")
  const toggle = row.getByRole("switch")
  expect(toggle.getAttribute("aria-disabled")).toBe("true")
  await act(async () => fireEvent.click(row.getByRole("button", { name: "Cancel operation" })))
  expect(view.actions).toEqual([{ type: "abortTransition", id: "alpha" }])
})

test("service failure is distinct from empty installations and blocks local actions", () => {
  const view = setup({ native: null, busy: false, errors: { service: "Storage unavailable" } })
  expect(view.getByRole("alert").textContent).toContain("Storage unavailable")
  expect(view.queryByText("No app extensions installed.")).toBeNull()
  expect((view.getByRole("button", { name: "Install from folder" }) as HTMLButtonElement).disabled).toBe(true)
})

test("bundled wallpaper can be disabled but has no manual update or uninstall actions", async (): Promise<void> => {
  const snapshot = state()
  const builtin = installation("alwith-static-wallpaper", "Wallpaper")
  builtin.source = "bundled:alwith-u"
  snapshot.native.installations = [builtin]
  const view = setup(snapshot)
  expect(view.queryByText("Built-in")).toBeNull()
  expect(view.queryByRole("button", { name: "More actions for Wallpaper" })).toBeNull()
  expect(view.queryByText("Uninstall")).toBeNull()
  await act(async () => {
    fireEvent.click(view.getByRole("switch"))
  })
  expect(view.actions).toEqual([{ type: "beginTransition", id: builtin.id, action: "disable" }])
})

test("metadata displays description, author link and remote icon even when disabled", async (): Promise<void> => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  item.enabled = false
  Object.assign(item.manifest, {
    description: "Personal notebook",
    author: "Example Team",
    authorUrl: "https://example.com/team",
    icon: "http://example.com/icon.png"
  })
  snapshot.native.installations = [item]
  const view = setup(snapshot)
  expect(view.getByText("Personal notebook")).toBeTruthy()
  const author = view.getByRole("link", { name: "Example Team" })
  expect(author.getAttribute("href")).toBe("https://example.com/team")
  expect(author.parentElement?.textContent).toBe("Example Team / v1.0.0")
  expect(view.queryByText("alpha", { exact: true })).toBeNull()
  expect(view.queryByText(/Running|Inactive/)).toBeNull()
  const image = view.container.querySelector("img")
  if (!image) throw new Error("Remote extension icon is missing")
  expect(image?.getAttribute("src")).toBe("http://example.com/icon.png")
  expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer")
  await act(async () => fireEvent.error(image))
  expect(view.container.querySelector("img")).toBeNull()
  expect(view.getByRole("region", { name: "Alpha Notes" }).querySelector(".lucide-blocks")).toBeTruthy()
})

test("search includes optional description and author", async (): Promise<void> => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  Object.assign(item.manifest, { description: "Notebook", author: "Example Team" })
  snapshot.native.installations[0] = item
  const view = setup(snapshot)
  for (const value of ["notebook", "example team"]) {
    await act(async () => {
      const input = view.getByRole("searchbox")
      input.focus()
      fireEvent.input(input, { target: { value } })
      fireEvent.keyUp(input, { key: "e" })
    })
    expect(view.getByText("Alpha Notes")).toBeTruthy()
    expect(view.queryByText("Beta Timer")).toBeNull()
  }
})

test("hovering extension information reveals full metadata and follows language changes", async (): Promise<void> => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  item.manifest.description = "A complete description that remains available when the list truncates it."
  item.manifest.author = "Example Team"
  item.manifest.authorUrl = "https://example.com/team"
  item.manifest.locales = { zh: { name: "阿尔法笔记", description: "完整的扩展简介，不因列表省略而丢失。" } }
  snapshot.native.installations = [item]
  const view = setup(snapshot)
  expect(view.queryByRole("tooltip")).toBeNull()
  await act(async () => {
    const information = view.getByRole("group", { name: "Details for Alpha Notes" })
    fireEvent.mouseEnter(information)
    fireEvent.mouseMove(information)
    await new Promise(resolve => setTimeout(resolve, 350))
  })
  const details = within(view.getByRole("tooltip"))
  for (const text of [
    "Alpha Notes",
    item.manifest.description,
    "Example Team",
    "1.0.0",
    "alpha",
    "https://example.com/team"
  ])
    expect(details.getByText(text)).toBeTruthy()
  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(details.getByText("阿尔法笔记")).toBeTruthy()
  expect(details.getByText("完整的扩展简介，不因列表省略而丢失。")).toBeTruthy()
  expect(details.getByText("作者")).toBeTruthy()
  expect(view.actions).toEqual([])
})

test("host language changes localize disabled extensions and uninstall prompts without runtime requests", async (): Promise<void> => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  item.enabled = false
  Object.assign(item.manifest, {
    description: "Personal notes"
  })
  item.manifest.locales = { "zh-CN": { name: "阿尔法笔记", description: "个人笔记" } }
  snapshot.native.installations = [item]
  const original = JSON.stringify(item.manifest)
  const view = setup(snapshot)
  expect(view.getByRole("region", { name: "Alpha Notes" })).toBeTruthy()
  expect(view.getByText("Personal notes")).toBeTruthy()
  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(view.getByRole("region", { name: "阿尔法笔记" })).toBeTruthy()
  expect(view.getByText("个人笔记")).toBeTruthy()
  expect(view.getByRole("switch", { name: i18n.t("extensions.enable", { name: "阿尔法笔记" }) })).toBeTruthy()
  expect(view.actions).toEqual([])
  expect(JSON.stringify(item.manifest)).toBe(original)
  await act(async () =>
    fireEvent.click(view.getByRole("button", { name: i18n.t("extensions.moreActions", { name: "阿尔法笔记" }) }))
  )
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: i18n.t("extensions.uninstall") })))
  expect(view.actions).toEqual([{ uninstall: "alpha", name: "阿尔法笔记" }])
  await act(async () => {
    await i18n.changeLanguage("fr")
  })
  expect(view.getByRole("region", { name: "Alpha Notes" })).toBeTruthy()
  expect(view.getByText("Personal notes")).toBeTruthy()
})

test("search follows localized titles and descriptions after a language switch", async (): Promise<void> => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  Object.assign(item.manifest, { description: "Personal notes" })
  item.manifest.locales = { zh: { name: "阿尔法笔记", description: "记录灵感" } }
  snapshot.native.installations[0] = item
  const view = setup(snapshot)
  await act(async () => {
    await i18n.changeLanguage("zh-CN")
    const input = view.getByRole("searchbox")
    input.focus()
    fireEvent.input(input, { target: { value: "灵感" } })
    fireEvent.keyUp(input, { key: "Enter" })
  })
  expect(view.getByText("阿尔法笔记")).toBeTruthy()
  expect(view.queryByText("Beta Timer")).toBeNull()
  await act(async () => {
    await i18n.changeLanguage("en")
  })
  expect(view.queryByText("Alpha Notes")).toBeNull()
  expect(view.getByText("No matching extensions.")).toBeTruthy()
})

test("disabled extensions render Lucide metadata icons locally without image requests", (): void => {
  const snapshot = state()
  const item = installation("alpha", "Alpha Notes")
  item.enabled = false
  item.manifest.icon = "lucide:clock"
  snapshot.native.installations = [item]
  const view = setup(snapshot)
  const row = view.getByRole("region", { name: "Alpha Notes" })
  expect(row.querySelector("svg.lucide-clock")).not.toBeNull()
  expect(row.querySelector("img")).toBeNull()
  expect(view.actions).toEqual([])
})

test("does not show a compatibility notice for supported Yup history", () => {
  const snapshot = state()
  snapshot.native.installations = [{ ...installation("yup-kb", "Knowledge"), source: "legacy:alwith-u" }]
  const view = setup(snapshot)
  expect(view.queryByText(/会话归档同步用户消息/)).toBeNull()
})

test("keeps Yup activation errors visible without a compatibility notice", () => {
  const snapshot = state()
  snapshot.native.installations = [{ ...installation("yup-kb", "Knowledge"), source: "legacy:alwith-u" }]
  snapshot.errors["yup-kb"] = "Activation failed"
  const view = setup(snapshot)
  expect(view.queryByText(/会话归档同步用户消息/)).toBeNull()
  expect(view.getByText("Activation failed")).toBeTruthy()
  expect(view.getByRole("switch").getAttribute("aria-checked")).toBe("true")
  expect(view.actions).toEqual([])
})
