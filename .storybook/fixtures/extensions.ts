import { extensionApiVersion } from "@alwith/module-extension"
import type { ExtensionRuntime } from "@alwith/module-extension/host"
import {
  createTauriExtensionRuntime,
  type Installation,
  type Request,
  type Response,
  type Snapshot
} from "@alwith/module-extension/tauri"
import { createElement, useSyncExternalStore } from "react"
import { createRoot, type Root } from "react-dom/client"
import { I18nextProvider } from "react-i18next"

import { version } from "../../package.json"
import { AppDirectionProvider } from "../../src/components/alwith-ui/app-direction-provider"
import { ThemeProvider } from "../../src/components/theme-provider"
import { GuidePage } from "../../src/features/guide/guide-page"
import { GeneralSection } from "../../src/features/settings/sections/general-section"
import i18n from "../../src/lib/i18n"

export type ExtensionCase =
  "installed" | "empty" | "loading" | "error" | "failed" | "pending" | "content" | "renderError"
const roots = new Set<Root>()
let failRender = true
let mode: ExtensionCase = "installed"
let native: Snapshot = { protocolVersion: 1, sequence: 1, serviceId: "storybook", installations: [], pending: [] }
export async function extensionRequest(request: Request): Promise<Response> {
  if (request.type === "snapshot") return { type: "snapshot", snapshot: native }
  if (request.type === "enable") {
    native = {
      ...native,
      sequence: native.sequence + 1,
      installations: native.installations.map((item) => (item.id === request.id ? { ...item, enabled: true } : item))
    }
    return { type: "ok" }
  }
  if (request.type === "beginTransition") {
    native = {
      ...native,
      sequence: native.sequence + 1,
      installations: native.installations
        .filter((item) => request.action !== "uninstall" || item.id !== request.id)
        .map((item) => (item.id === request.id ? { ...item, enabled: false } : item))
    }
    return { type: "ok" }
  }
  if (request.type === "installLocal") {
    const { expectedId: id, expectedVersion: version, expectedDigest: digest } = request
    if (!id || !version || !digest) throw new Error("Incomplete extension package selection")
    const template = native.installations[0]
    if (!template) throw new Error("Missing extension package fixture")
    native = {
      ...native,
      sequence: native.sequence + 1,
      installations: [
        ...native.installations,
        {
          ...template,
          id,
          installationId: id,
          packageRevision: digest,
          enabled: false,
          manifest: { ...template.manifest, id, name: "交付助手", version }
        }
      ]
    }
    return { type: "ok" }
  }
  if (request.type === "register")
    return {
      type: "token",
      activation: {
        dataGeneration: native.installations.find((item) => item.id === request.id)?.dataGeneration ?? 1,
        installationId: request.id,
        packageRevision: native.installations.find((item) => item.id === request.id)?.packageRevision ?? "1",
        token: request.id
      }
    }
  if (request.type === "readData")
    return { type: "data", data: { generation: 1, revision: 1, schemaVersion: 1, value: {} } }
  if (request.type === "readResource") return { type: "resource", bytes: [], mime: "text/javascript" }
  return { type: "ok" }
}
function createRuntime(): ExtensionRuntime {
  return createTauriExtensionRuntime({
    apiVersion: extensionApiVersion,
    host: { id: "alwith-u", version },
    capabilities: {},
    contributions: {
      surfaces: "1.0.0",
      settings: "1.0.0",
      settingsPages: "1.0.0",
      navigation: "1.0.0",
      topBar: "1.0.0",
      statusBar: "1.0.0"
    },
    evaluate: async () => {
      if (mode === "failed") throw new Error("模拟扩展启动失败，请重载后重试。")
      return (context) => ({
        onload() {
          if (mode !== "content" && mode !== "renderError") return
          for (const [kind, id, title, component] of [
            ["surfaces", "demo-content", "项目工具 · 使用指南", GuidePage],
            ["settingsPages", "demo-settings", "项目工具 · 设置", GeneralSection]
          ] as const)
            context.view<HTMLElement>(kind, {
              id,
              title,
              mount({ container }) {
                if (mode === "renderError" && failRender) {
                  failRender = false
                  throw new Error("模拟扩展内容渲染失败")
                }
                const root = createRoot(container)
                roots.add(root)
                root.render(
                  createElement(
                    I18nextProvider,
                    { i18n },
                    createElement(
                      AppDirectionProvider,
                      null,
                      createElement(ThemeProvider, null, createElement(component))
                    )
                  )
                )
                return () => {
                  if (roots.delete(root)) root.unmount()
                }
              }
            })
          context.action("navigation", {
            id: "demo-navigation",
            title: "项目工具",
            target: { type: "surface", id: "demo-content" },
            icon: "book-open"
          })
          context.action("topBar", {
            id: "demo-toolbar",
            title: "打开项目工具",
            target: { type: "surface", id: "demo-content" },
            icon: "book-open"
          })
          context.view<HTMLElement>("statusBar", {
            id: "demo-status",
            title: "项目工具状态",
            mount({ container }) {
              container.textContent = "项目工具已就绪"
              return () => {
                container.textContent = ""
              }
            }
          })
        }
      })
    }
  })
}
let runtime = createRuntime()
export async function resetExtensions(kind: ExtensionCase = "installed"): Promise<void> {
  await runtime.dispose()
  for (const root of roots) root.unmount()
  roots.clear()
  failRender = true
  mode = kind
  native = {
    protocolVersion: 1,
    sequence: 1,
    serviceId: "storybook",
    installations:
      kind === "empty" || kind === "loading" || kind === "error"
        ? []
        : ["项目工具", "资料助手", "图表工具"].map((name, index): Installation => ({
            id: `demo-${index}`,
            installationId: `demo-${index}`,
            dataGeneration: 1,
            packageRevision: "1",
            enabled: index === 0,
            source: "local",
            manifest: {
              id: `demo-${index}`,
              name,
              description: "用于模拟项目工作中的扩展安装、启用和停用状态。",
              author: "示例团队",
              version: "1.0.0",
              entry: "main.js",
              dataSchemaVersion: 1,
              manifestVersion: 3,
              dependencies: { "@alwith/module-extension": `^${extensionApiVersion}` },
              hosts: {}
            }
          })),
    pending: kind === "pending" ? [{ id: "demo-0", action: "reload", waitingInstances: 1 }] : []
  }
  runtime = createRuntime()
  if (kind !== "loading") await runtime.start()
}
export function useExtensions() {
  const state = useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot)
  const host = useSyncExternalStore(runtime.host.subscribe, runtime.host.snapshot, runtime.host.snapshot)
  return {
    state: mode === "error" ? { ...state, native: null, errors: { service: "模拟扩展服务连接失败。" } } : state,
    host,
    runtime
  }
}
export async function startExtensionRuntime() {
  await runtime.start()
  return runtime
}
export function reportExtensionError(error: unknown): void {
  // Expected fixture failures are surfaced by the source view and its retry control.
  if (!(error instanceof Error && error.message === "模拟扩展内容渲染失败")) console.error(error)
}
