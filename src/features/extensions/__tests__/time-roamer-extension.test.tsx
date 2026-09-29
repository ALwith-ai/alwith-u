import { act, fireEvent, render } from "@testing-library/react"
import { expect, setSystemTime, spyOn, test } from "bun:test"
import * as sdk from "@alwith/module-extension"
import * as dom from "@alwith/module-extension/dom"
import { createCommonJsEvaluator, ExtensionHost } from "@alwith/module-extension/host"
import { mountReact } from "@alwith/module-extension/react"
import { createMemoryData } from "@alwith/module-extension/testing"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import * as jsxDevRuntime from "react/jsx-dev-runtime"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import i18n, { initI18n } from "@/lib/i18n"
import { ExtensionViewContent } from "../extension-view"
import { ExtensionsManager } from "../extensions-manager"
import * as extensionUi from "../ui"

installDom()

test("disabled bundled clock shows localized metadata immediately when the app language changes", async (): Promise<void> => {
  const manifest = sdk.parseManifest(
    await Bun.file(
      new URL("../../../../src-tauri/resources/extensions/alwith-time-roamer/manifest.json", import.meta.url)
    ).json()
  )
  await initI18n("en")
  const rejectAction = (): never => {
    throw new Error("Metadata localization must not activate the extension")
  }
  const ui = render(
    <ExtensionsManager
      state={{
        busy: false,
        errors: {},
        native: {
          protocolVersion: 1,
          serviceId: "test",
          sequence: 1,
          pending: [],
          installations: [
            {
              id: manifest.id,
              installationId: "clock",
              enabled: false,
              packageRevision: "clock",
              dataGeneration: 1,
              source: "bundled:alwith-u",
              manifest
            }
          ]
        }
      }}
      host={{ actions: [], commands: [], views: [], instances: [] }}
      busy={false}
      onInstall={rejectAction}
      onRequest={rejectAction}
      onUninstall={rejectAction}
      renderSettings={() => null}
    />
  )
  try {
    expect(ui.getByRole("region", { name: "Time Roamer" })).toBeTruthy()
    expect(ui.getByText("Local clock, daily moods and day progress")).toBeTruthy()
    await act(async () => {
      await i18n.changeLanguage("zh-CN")
    })
    expect(ui.getByRole("region", { name: "时间漫游" })).toBeTruthy()
    expect(ui.getByText("本地时钟、时段心情与今日进度")).toBeTruthy()
    expect(ui.getByRole("switch").getAttribute("aria-checked")).toBe("false")
    await act(async () => {
      await i18n.changeLanguage("fr")
    })
    expect(ui.getByRole("region", { name: "Time Roamer" })).toBeTruthy()
  } finally {
    await act(async () => {
      ui.unmount()
    })
  }
})

test("bundled clock switches modes, rolls over midnight and releases timers on unmount and disable", async (): Promise<void> => {
  const root = new URL("../../../../src-tauri/resources/extensions/alwith-time-roamer/", import.meta.url)
  expect(await Bun.file(new URL("manifest.json", root)).exists()).toBe(true)
  const manifest = sdk.parseManifest(await Bun.file(new URL("manifest.json", root)).json())
  const factory = createCommonJsEvaluator({
    "@alwith/module-extension": sdk,
    "@alwith/module-extension/dom": dom,
    "@alwith/module-extension/react": { mountReact },
    "@alwith/u-extension-ui": extensionUi,
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react/jsx-dev-runtime": jsxDevRuntime
  })(await Bun.file(new URL("main.js", root)).text())
  await initI18n("zh-CN")
  const originalLanguage = document.documentElement.lang
  document.documentElement.lang = "zh-CN"
  const host = new ExtensionHost({
    apiVersion: sdk.extensionApiVersion,
    host: { id: "alwith-u", version: "0.1.1" },
    contributions: { statusBar: "1.0.0" }
  })
  const timers = new Map<number, () => void>()
  let nextTimer = 0
  const schedule = spyOn(window, "setTimeout").mockImplementation((handler: TimerHandler): number => {
    if (typeof handler !== "function") throw new Error("Expected a timer callback")
    const id = ++nextTimer
    timers.set(id, () => handler())
    return id
  })
  const cancel = spyOn(window, "clearTimeout").mockImplementation((id?: number): void => {
    if (id !== undefined) timers.delete(id)
  })
  const errors: unknown[] = []
  const resources: string[] = []
  const data = createMemoryData()
  let ui: ReturnType<typeof render> | undefined
  try {
    setSystemTime(new Date(2026, 8, 30, 23, 59, 59))
    await host.activate(manifest, "clock", factory, {
      data,
      resource: path => {
        resources.push(path)
        return "data:text/css,"
      }
    })
    expect(host.snapshot().views).toMatchObject([
      { id: "alwith-time-roamer/clock", kind: "statusBar", alignment: "right" }
    ])
    ui = render(
      <ExtensionViewContent host={host} id="alwith-time-roamer/clock" onError={error => errors.push(error)} />
    )
    const firstView = ui
    await act(async () => {})
    expect(ui.getByRole("button").textContent).toContain("23:59")
    expect(timers.size).toBe(1)
    await act(async () => {
      fireEvent.click(firstView.getByRole("button"))
    })
    expect(ui.getByRole("button").textContent).toContain("99%")
    expect(ui.getByRole("button").getAttribute("aria-pressed")).toBe("true")

    await act(async () => {
      setSystemTime(new Date(2026, 9, 1, 0, 0))
      const pending = [...timers.values()]
      timers.clear()
      for (const tick of pending) tick()
    })
    expect(ui.getByRole("button").textContent).toContain("0%")
    expect(ui.getByRole("button").title).toContain("10月1日")
    await act(async () => {
      fireEvent.click(firstView.getByRole("button"))
      setSystemTime(new Date(2026, 9, 1, 14, 32))
      window.dispatchEvent(new Event("focus"))
    })
    expect(ui.getByRole("button").textContent).toContain("14:32")
    expect(ui.getByRole("button").textContent).toContain("午后漫游")
    await act(async () => {
      document.documentElement.lang = "en"
    })
    expect(ui.getByRole("button").textContent).toContain("Afternoon wander")
    expect(ui.getByRole("button").title).toContain("Thursday, October 1, 2026")
    expect(ui.getByRole("button").getAttribute("aria-label")).toContain("Show day progress")
    await act(async () => {
      fireEvent.click(firstView.getByRole("button"))
    })
    expect(ui.getByRole("button").textContent).toContain("60% of today explored")
    await act(async () => {
      document.documentElement.lang = "zh-CN"
    })
    expect(ui.getByRole("button").textContent).toContain("今天已走过 60%")
    expect(ui.getByRole("button").getAttribute("aria-pressed")).toBe("true")
    expect(timers.size).toBe(1)
    await act(async () => firstView.unmount())
    expect(timers.size).toBe(0)
    ui = render(
      <ExtensionViewContent host={host} id="alwith-time-roamer/clock" onError={error => errors.push(error)} />
    )
    await act(async () => {})
    expect(timers.size).toBe(1)
    await act(async () => {
      await host.deactivate(manifest.id)
    })
    expect(timers.size).toBe(0)
    expect(ui.queryByRole("button")).toBeNull()
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    expect(timers.size).toBe(0)
    expect(await data.read()).toBeNull()
    expect(resources).toContain("styles.css")
    expect(errors).toEqual([])
  } finally {
    await act(async () => {
      ui?.unmount()
      await host.dispose()
    })
    schedule.mockRestore()
    cancel.mockRestore()
    setSystemTime()
    document.documentElement.lang = originalLanguage
  }
})
