import { act, fireEvent, render } from "@testing-library/react"
import { expect, test } from "bun:test"
import { ExtensionHost } from "@alwith/module-extension/host"
import { createMemoryData } from "@alwith/module-extension/testing"
import { initI18n } from "@/lib/i18n"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { ExtensionViewContent } from "../extension-view"
import * as sdk from "@alwith/module-extension"
import * as dom from "@alwith/module-extension/dom"
import { mountReact } from "@alwith/module-extension/react"
import { createCommonJsEvaluator } from "@alwith/module-extension/host"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import * as jsxDevRuntime from "react/jsx-dev-runtime"
import * as reactDom from "react-dom/client"
import * as extensionUi from "../ui"
import builtManifest from "../../../../src-tauri/resources/extensions/alwith-static-wallpaper/manifest.json"
import { wallpaperCapability } from "@/features/extensions/capabilities/wallpaper-contract"
import { WallpaperController } from "@/features/appearance/wallpaper/controller"

installDom()
test("wallpaper selection is a draft until apply and disabling clears the host background", async (): Promise<void> => {
  await initI18n("en")
  const factory = createCommonJsEvaluator({
    "@alwith/module-extension": sdk,
    "@alwith/module-extension/dom": dom,
    "@alwith/module-extension/react": { mountReact },
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react/jsx-dev-runtime": jsxDevRuntime,
    "react-dom/client": reactDom,
    "@alwith/u-extension-ui": extensionUi
  })(
    await Bun.file(
      new URL("../../../../src-tauri/resources/extensions/alwith-static-wallpaper/main.js", import.meta.url)
    ).text()
  )
  const defaults = await Bun.file(
    new URL("../../../../src-tauri/resources/extensions/alwith-static-wallpaper/data.json", import.meta.url)
  ).text()
  const defaultUrl = `data:application/json,${encodeURIComponent(defaults)}`
  const resources: string[] = []
  const data = createMemoryData()
  const controller = new WallpaperController()
  const errors: unknown[] = []
  let finishImport: (() => void) | undefined
  const host = new ExtensionHost({
    apiVersion: "0.1.0",
    host: { id: "alwith-u", version: "0.1.1" },
    contributions: { settingsPages: "1.0.0" },
    capabilities: {
      [wallpaperCapability.id]: {
        version: "1.0.0",
        create: binding => {
          const presentation = controller.bind()
          binding.cancellation.subscribe(presentation.dispose)
          return {
            ...presentation,
            language: () => "en",
            subscribeLanguage: () => () => {},
            listImages: async () => [],
            importImage: () =>
              new Promise<null>(resolve => {
                finishImport = () => resolve(null)
              }),
            imageUrl: (id: string) => `wallpaper://localhost/${id}`,
            removeImage: async () => false,
            reportError: (error: unknown) => {
              errors.push(error)
            }
          }
        }
      }
    }
  })
  await host.activate(sdk.parseManifest(builtManifest), "one", factory, {
    data,
    resource: path => {
      resources.push(path)
      if (path === "data.json") return defaultUrl
      return path === "styles.css" ? "data:text/css," : `extension://localhost/token/${path}`
    }
  })
  const ui = render(
    <ExtensionViewContent host={host} id="alwith-static-wallpaper/wallpaper" onError={error => errors.push(error)} />
  )
  try {
    await act(async () => {})
    expect(controller.snapshot()).toBeNull()
    expect(resources).toContain("data.json")
    expect(await data.read()).toBeNull()
    expect(ui.queryByRole("heading", { name: "Wallpaper" })).toBeNull()
    await act(async () => {
      fireEvent.click(ui.getByRole("switch", { name: "Show wallpaper" }))
    })
    expect(controller.snapshot()?.url).toContain("mist.jpg")
    expect((await data.read())?.value).toMatchObject({ id: "mist", visible: true })
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Quiet dunes" }))
    })
    expect((await data.read())?.value).toMatchObject({ id: "mist", visible: true })
    await act(async () => {
      fireEvent.click(ui.getByRole("switch", { name: "Show wallpaper" }))
    })
    expect(controller.snapshot()).toBeNull()
    expect((await data.read())?.value).toMatchObject({ id: "mist", visible: false })
    expect(ui.getByRole("button", { name: "Quiet dunes" }).getAttribute("aria-pressed")).toBe("true")
    await act(async () => {
      fireEvent.click(ui.getByRole("switch", { name: "Show wallpaper" }))
    })
    expect((await data.read())?.value).toMatchObject({ id: "mist", visible: true })

    expect(controller.snapshot()?.url).toContain("mist.jpg")
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Apply" }))
    })
    expect((await data.read())?.value).toMatchObject({ id: "dunes" })
    expect(controller.snapshot()?.url).toContain("dunes.jpg")
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Nightfall" }))
    })
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Cancel" }))
    })
    expect(ui.getByRole("button", { name: "Quiet dunes" }).getAttribute("aria-pressed")).toBe("true")
    await act(async () => {
      const snapshot = await data.read()
      if (!snapshot) throw new Error("Expected saved wallpaper data")
      await data.write(
        { ...(snapshot.value as Record<string, string | number | boolean>), id: "ocean" },
        snapshot.revision,
        1
      )
    })
    expect(ui.getByRole("button", { name: "Open water" }).getAttribute("aria-pressed")).toBe("true")
    await act(async () => {
      fireEvent.click(ui.getByRole("switch", { name: "Show wallpaper" }))
    })
    expect(controller.snapshot()).toBeNull()
    expect(ui.getByRole("button", { name: "Apply" }).hasAttribute("disabled")).toBe(true)
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Cancel" }))
    })
    expect((await data.read())?.value).toMatchObject({ visible: false })

    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Nightfall" }))
    })
    await act(async () => {
      const snapshot = await data.read()
      if (!snapshot) throw new Error("Expected saved wallpaper data")
      await data.write(
        { ...(snapshot.value as Record<string, string | number | boolean>), id: "forest" },
        snapshot.revision,
        1
      )
    })
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Apply" }))
    })
    expect(ui.getByRole("alert").textContent).toContain("conflict")
    await act(async () => {
      fireEvent.click(ui.getByRole("switch", { name: "Show wallpaper" }))
    })
    expect(ui.getByRole("switch", { name: "Show wallpaper" }).getAttribute("aria-checked")).toBe("false")
    expect((await data.read())?.value).toMatchObject({ id: "forest", visible: false })

    expect((await data.read())?.value).toMatchObject({ id: "forest" })
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Restore defaults" }))
    })
    expect((await data.read())?.value).toMatchObject({ id: "mist", brightness: 100, blur: 0 })

    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Import image" }))
    })
    await act(async () => {
      const snapshot = await data.read()
      if (!snapshot) throw new Error("Expected saved wallpaper data")
      await data.write(
        { ...(snapshot.value as Record<string, string | number | boolean>), id: "glacier" },
        snapshot.revision,
        1
      )
    })
    expect(ui.getByRole("button", { name: "Mountain mist" }).getAttribute("aria-pressed")).toBe("true")
    await act(async () => {
      if (!finishImport) throw new Error("Import dialog should be pending")
      finishImport()
    })
    expect(ui.getByRole("button", { name: "Glacier" }).getAttribute("aria-pressed")).toBe("true")

    await act(async () => {
      await host.deactivate(builtManifest.id)
    })
    expect(controller.snapshot()).toBeNull()
    expect(errors).toEqual([])
  } finally {
    await act(async () => {
      ui.unmount()
      await host.dispose()
    })
  }
})
