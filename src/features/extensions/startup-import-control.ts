import { getCurrentWindow } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { commands } from "@/bindings"
import i18n from "@/lib/i18n"
import { executeStagedInstall } from "./install-service"
import { startExtensionRuntime } from "./runtime"
import { runStartupImports } from "./startup-import"

let startup: Promise<void> | undefined

/** Runs outside the auth gate, once in the main WebView; native scan also guards the process. */
export function startStartupImports(): Promise<void> {
  if (getCurrentWindow().label !== "main") return Promise.resolve()
  startup ??= (async () => {
    const runtime = await startExtensionRuntime()
    await runStartupImports({
      scan: () => commands.extensionInboxScan(),
      prepare: async taskId => {
        const task = await commands.extensionInboxPrepare({ taskId })
        if (task.phase !== "prepared" && task.phase !== "committed") throw new Error("Unknown startup import phase")
        return { ...task, phase: task.phase }
      },
      install: async pkg => {
        const result = await executeStagedInstall(
          runtime,
          pkg,
          { update: true, enable: false },
          AbortSignal.timeout(120_000)
        )
        if (result.error) throw new Error(result.error.message)
      },
      complete: async taskId => {
        await commands.extensionInboxComplete({ taskId })
      },
      failed: async (taskId, message) => {
        await commands.extensionInboxFailed({ taskId, message })
      },
      report: message => toast.error(i18n.t("extensions.startupImportFailed", { message }), { duration: 12_000 })
    })
  })()
  return startup
}
