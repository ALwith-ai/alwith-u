import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { platform } from "@tauri-apps/plugin-os"
import { createInstallCoordinator } from "./install-coordinator"
import { executePreparedInstall, type InstallResult, type PreparedInstall } from "./install-service"
import { executeUninstall } from "./uninstall-service"
import { getUninstallFailures, reportExtensionError, startExtensionRuntime } from "./runtime"

type ControlJob =
  | { operation: "install"; requestId: string; prepared: PreparedInstall; update: boolean; enable: boolean }
  | { operation: "uninstall"; requestId: string; id: string }

let stop: (() => void) | undefined

/** Main-window control runs independently of authentication and settings navigation. */
export async function startExtensionInstallControl(): Promise<void> {
  if (!["macos", "windows"].includes(platform()) || getCurrentWindow().label !== "main") return
  await invoke("extension_control_status")
  const runtime = await startExtensionRuntime().catch(async error => {
    await invoke("extension_control_unavailable", { message: error instanceof Error ? error.message : String(error) })
    throw error
  })
  const coordinator = createInstallCoordinator<ControlJob, InstallResult>({
    next: () => invoke("extension_control_next"),
    execute: job =>
      job.operation === "uninstall"
        ? executeUninstall(runtime, job.id, getUninstallFailures())
        : executePreparedInstall(
            runtime,
            job.prepared,
            { update: job.update, enable: job.enable },
            {
              stageLegacy: (ticket, converted) => invoke("legacy_stage_import", { ticket, ...converted })
            }
          ),
    complete: (requestId, result, error) => invoke("extension_control_complete", { requestId, result, error })
  })
  const wake = (): void => {
    void coordinator.drain().catch(reportExtensionError)
  }
  const unlisten = await listen("extension-control:queued", wake)
  // Recover a queued request even if its wake event was lost during WebView initialization.
  const timer = window.setInterval(wake, 1000)
  stop = () => {
    unlisten()
    window.clearInterval(timer)
  }
  wake()
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stop?.()
  })
