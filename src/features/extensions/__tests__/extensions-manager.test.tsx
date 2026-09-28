import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { afterEach, beforeEach, expect, test } from "bun:test"
import type { HostSnapshot, RuntimeSnapshot } from "@alwith/module-extension/host"
import type { Installation, Request } from "@alwith/module-extension/tauri"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { initI18n } from "@/lib/i18n"
import { ExtensionsManager } from "../extensions-manager"

installDom()
beforeEach(async () => {
  await initI18n("en")
})
afterEach(async () => {
  await act(async () => {
    cleanup()
    await Bun.sleep(0)
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
      manifestVersion: 2,
      entry: "main.js",
      dataSchemaVersion: 1,
      engines: { extension: "^0.1.0" },
      externals: [],
      capabilities: { required: {}, optional: {} },
      contributions: { required: {}, optional: {} }
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
function setup(snapshot: RuntimeSnapshot = state(), busy = false) {
  const actions: unknown[] = []
  const view = render(
    <ExtensionsManager
      state={snapshot}
      host={host}
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
      renderSettings={() => null}
    />
  )
  return { ...view, actions }
}

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
