import type { ExtensionRuntime } from "@alwith/module-extension/host"
import { getCurrentWindow } from "@tauri-apps/api/window"

import { commands } from "@/bindings"
import { reportBackgroundError } from "@/lib/background-errors"
import i18n from "@/lib/i18n"

import { executeReload, executeStagedInstall } from "./install-service"
import { type ReloadOutcome, runExtensionReload } from "./reload-service"
import { requestMainReload, serveMainReload } from "./reload-window"
import { startExtensionRuntime } from "./runtime"
import { runStartupImports, type StartupImportPort } from "./startup-import"

let startup: Promise<void> | undefined
let stopReload: (() => void) | undefined

/** Recover the full startup chain before treating a fresh snapshot as healthy. */
export async function refreshExtensions(): Promise<void> {
  const runtime = await startExtensionRuntime()
  await startStartupImports()
  await runtime.refresh()
}

/** Runs outside the auth gate, once in the main WebView; native scan also guards the process. */
export function startStartupImports(): Promise<void> {
  if (getCurrentWindow().label !== "main") return Promise.resolve()
  startup ??= (async () => {
    stopReload ??= await serveMainReload(async (id) => {
      return updateAndReloadExtension(await startExtensionRuntime(), id)
    })
    const runtime = await startExtensionRuntime()
    await runStartupImports({
      ...inboxPort(),
      install: async (pkg) => {
        const result = await executeStagedInstall(runtime, pkg, { update: true }, AbortSignal.timeout(120_000))
        if (result.error) throw new Error(result.error.message)
      },
      report: (message) =>
        reportBackgroundError("extension-startup", message, {
          message: i18n.t("extensions.startupImportFailed", { message })
        })
    })
  })().catch((error: unknown) => {
    startup = undefined
    throw error
  })
  return startup
}

/** The native scan reservation serializes this operation against startup and other windows. */
export async function updateAndReloadExtension(runtime: ExtensionRuntime, id: string): Promise<ReloadOutcome> {
  if (getCurrentWindow().label !== "main") return requestMainReload(id)
  // Startup reports its own errors; a failed input must not disable manual recovery.
  await Promise.allSettled([startStartupImports()])
  await runtime.refresh()
  const check = (): void => {
    const native = runtime.snapshot().native
    if (!native?.installations.some((item) => item.id === id && item.enabled))
      throw new Error("Extension is not installed and enabled")
    if (native.pending.some((item) => item.id === id)) throw new Error("Extension is transitioning")
  }
  check()
  return runExtensionReload(id, {
    ...inboxPort(id),
    install: async (pkg) => {
      check()
      const selected = runtime.snapshot().native?.installations.find((item) => item.id === id)
      if (selected?.source !== pkg.source) throw new Error("Extension belongs to a different installation source")
      if (selected.packageRevision === pkg.digest) return "unchanged"
      const result = await executeStagedInstall(
        runtime,
        pkg,
        { update: true, enable: false },
        AbortSignal.timeout(120_000)
      )
      if (result.error) throw new Error(result.error.message)
      return "updated"
    },
    reload: async () => {
      check()
      const result = await executeReload(runtime, id, AbortSignal.timeout(120_000))
      if (result.error) throw new Error(result.error.message)
    }
  })
}

function inboxPort(
  extensionId?: string
): Pick<StartupImportPort, "scan" | "prepare" | "complete" | "failed"> & { finish: () => Promise<void> } {
  let operationId: string | undefined
  const operation = (): string => {
    if (!operationId) throw new Error("Extension inbox operation has not started")
    return operationId
  }
  return {
    scan: async () => {
      const result = await (extensionId
        ? commands.extensionInboxScanExtension({ extensionId })
        : commands.extensionInboxScan())
      if (!result.operationId) throw new Error("Extension inbox scan returned no operation identity")
      operationId = result.operationId
      return result
    },
    prepare: async (taskId) => {
      const task = await commands.extensionInboxPrepare({ taskId, operationId: operation() })
      if (task.phase !== "prepared" && task.phase !== "committed") throw new Error("Unknown import phase")
      return { ...task, phase: task.phase }
    },
    complete: async (taskId) => {
      await commands.extensionInboxComplete({ taskId, operationId: operation() })
    },
    failed: async (taskId, message) => {
      await commands.extensionInboxFailed({ taskId, message, operationId: operation() })
    },
    finish: async () => {
      await commands.extensionInboxFinish({ operationId: operation() })
    }
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => stopReload?.())
