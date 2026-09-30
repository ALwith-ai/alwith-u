import { isTauri } from "@tauri-apps/api/core"
import { attachConsole, info, error as logError } from "@tauri-apps/plugin-log"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import { App } from "@/app"
import { AppDirectionProvider } from "@/components/alwith-ui/app-direction-provider"
import { ErrorBoundary } from "@/components/error-boundary"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthGate } from "@/features/auth/auth-gate"
import { initPlatformAuth } from "@/features/auth/store"
import { hydrateNavigationSound } from "@/features/chat/codex/navigation-sound-store"
import { useUpdaterStore } from "@/features/updater/store"
import { initI18n } from "@/lib/i18n"
import { startPreferenceSync } from "@/lib/preference-sync"
import { loadPreferences } from "@/lib/preferences"
import { hydrateZoom } from "@/lib/zoom"
import "./index.css"

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

window.addEventListener("unhandledrejection", event => surfaceGlobalError(describe(event.reason)))
window.addEventListener("error", event => {
  // Benign browser noise: the layout settled one frame late. VS Code and Sentry filter it too.
  if (event.message.startsWith("ResizeObserver loop")) return
  surfaceGlobalError(`${event.message} @ ${event.filename}:${event.lineno}:${event.colno}\n${event.error?.stack ?? ""}`)
})

async function bootstrap(): Promise<void> {
  await attachConsole()
  await info("frontend booting")
  const preferences = await loadPreferences()
  await initI18n(preferences.language)
  if (isTauri()) {
    void useUpdaterStore
      .getState()
      .init()
      .catch((error: unknown) => surfaceGlobalError(describe(error)))
  }
  await hydrateZoom(preferences.zoomLevel)
  hydrateNavigationSound({ soundMode: preferences.navigationSoundMode, instrument: preferences.navigationInstrument })
  void startPreferenceSync()
  await initPlatformAuth()
  const root = document.getElementById("root")
  if (!root) throw new Error("index.html has no #root")
  createRoot(root).render(
    <StrictMode>
      <AppDirectionProvider>
        <ThemeProvider>
          <TooltipProvider>
            <ErrorBoundary>
              <AuthGate>
                <App initialPreferences={preferences} />
              </AuthGate>
            </ErrorBoundary>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </AppDirectionProvider>
    </StrictMode>
  )
}

bootstrap().catch((failure: unknown) => surfaceGlobalError(`bootstrap failed: ${describe(failure)}`))
