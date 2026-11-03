import { DriveNotificationProvider } from "@alwith/module-drive/react"
import { isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { attachConsole, error as logError, info } from "@tauri-apps/plugin-log"
import { platform } from "@tauri-apps/plugin-os"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"

import { App } from "@/app"
import { AppDirectionProvider } from "@/components/alwith-ui/app-direction-provider"
import { WindowsMainWindowShell } from "@/components/alwith-ui/windows-main-window-shell"
import { ErrorBoundary } from "@/components/error-boundary"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ZoomFeedback } from "@/features/appearance/zoom-feedback"
import { AuthGate } from "@/features/auth/auth-gate"
import { initPlatformAuth } from "@/features/auth/store"
import { hydrateNavigationSound } from "@/features/chat/codex/navigation-sound-store"
import { predictionPreference } from "@/features/chat/composer/prediction-preference"
import { restoreComputer } from "@/features/computer/operations"
import { reportExtensionError } from "@/features/extensions/runtime"
import { startStartupImports } from "@/features/extensions/startup-import-control"
import { initializeMobile } from "@/features/mobile/bridge"
import { initializeVibemonMain } from "@/features/vibemon/main-host"
import { initI18n } from "@/lib/i18n"
import { startPreferenceSync } from "@/lib/preference-sync"
import { loadPreferences } from "@/lib/preferences"
import { bootstrapSettings } from "@/lib/settings-store"
import { showStartupFailure, startupStep } from "@/lib/startup-step"
import { hydrateZoom } from "@/lib/zoom"
import { startZoomViewport } from "@/lib/zoom-viewport"
import "./index.css"

const driveNotices = {
  error(message: string): void {
    toast.error(message, { id: "drive-background-error" })
  },
  success(message: string): void {
    toast.success(message, { id: "drive-task-completed" })
  }
}

function describe(value: unknown): string {
  return value instanceof Error ? `${value.message}\n${value.stack ?? ""}` : String(value)
}

// Uncaught errors are shown once per cause (a polling failure must not flood the screen)
// and always written to the Tauri log file. A failing log call must not re-enter these
// handlers, so its rejection is swallowed here.
const seenGlobalErrors = new Set<string>()
function surfaceGlobalError(message: string): void {
  const cause = message.split("\n", 1)[0]
  if (!seenGlobalErrors.has(cause)) {
    seenGlobalErrors.add(cause)
    toast.error(cause)
  }
  logError(message).catch((failure: unknown) => console.error("[logError]", failure))
}

window.addEventListener("unhandledrejection", (event) => surfaceGlobalError(describe(event.reason)))
window.addEventListener("error", (event) => {
  // Benign browser noise: the layout settled one frame late. VS Code and Sentry filter it too.
  if (event.message.startsWith("ResizeObserver loop")) return
  surfaceGlobalError(
    `${event.message} @ ${event.filename}:${event.lineno}:${event.colno}\n${(event.error as { stack?: string } | null | undefined)?.stack ?? ""}`
  )
})

async function bootstrap(): Promise<void> {
  if (isTauri() && platform() === "windows") {
    document.documentElement.dataset.windowBackdrop = "acrylic"
  }
  await startupStep("settings", bootstrapSettings)
  await startupStep("mobile", initializeMobile).catch((error: unknown) => surfaceGlobalError(describe(error)))
  await startupStep("console", attachConsole)
  await info("frontend booting")
  const preferences = await startupStep("preferences", loadPreferences)
  predictionPreference.setState({ enabled: preferences.composerPredictions ?? true })
  await startupStep("language", () => initI18n(preferences.language))
  if (isTauri()) {
    await startupStep("power listener", () =>
      listen<string>("power:error", ({ payload }) => surfaceGlobalError(payload))
    )
    await startupStep("computer", restoreComputer).catch((error: unknown) => surfaceGlobalError(describe(error)))
    void startStartupImports().catch(reportExtensionError)
  }
  await startupStep("viewport", startZoomViewport)
  await startupStep("zoom", () => hydrateZoom(preferences.zoomLevel))
  hydrateNavigationSound({ soundMode: preferences.navigationSoundMode, instrument: preferences.navigationInstrument })
  void startPreferenceSync()
  await startupStep("auth listeners", initPlatformAuth)
  await startupStep("vibemon host", initializeVibemonMain)
  const root = document.getElementById("root")
  if (!root) throw new Error("index.html has no #root")
  createRoot(root).render(
    <StrictMode>
      <AppDirectionProvider>
        <ThemeProvider>
          <TooltipProvider>
            <ErrorBoundary>
              <DriveNotificationProvider notify={driveNotices}>
                <WindowsMainWindowShell>
                  <AuthGate>
                    <App initialPreferences={preferences} />
                    <ZoomFeedback />
                  </AuthGate>
                </WindowsMainWindowShell>
              </DriveNotificationProvider>
            </ErrorBoundary>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </AppDirectionProvider>
    </StrictMode>
  )
  void info("[startup] root render requested").catch(console.error)
}

bootstrap().catch((failure: unknown) => {
  showStartupFailure(failure)
  surfaceGlobalError(`bootstrap failed: ${describe(failure)}`)
})
