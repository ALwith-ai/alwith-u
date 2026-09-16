import { attachConsole, error as logError, info } from "@tauri-apps/plugin-log"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { AppDirectionProvider } from "@/components/alwith-ui/app-direction-provider"
import { ErrorBoundary } from "@/components/error-boundary"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"
import { loadPreferences } from "@/lib/preferences"
import { hydrateZoom } from "@/lib/zoom"
import { hydrateNavigationSound } from "@/features/chat/codex/navigation-sound-store"
import { startPreferenceSync } from "@/lib/preference-sync"
import { App } from "@/app"
import { AuthGate } from "@/features/auth/auth-gate"
import { initPlatformAuth } from "@/features/auth/store"
import "./index.css"

function describe(value: unknown): string {
  return value instanceof Error ? `${value.message}\n${value.stack ?? ""}` : String(value)
}

// Uncaught errors are shown once per cause (a polling failure must not flood the screen)
// and always written to the Tauri log file. A failing log call must not re-enter these
// handlers, so its rejection is swallowed here.
const seenGlobalErrors = new Set<string>()
function surfaceGlobalError(message: string): void {
  const cause = message.split("\n", 1)[0]!
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
  await hydrateZoom(preferences.zoomLevel)
  hydrateNavigationSound({ soundMode: preferences.navigationSoundMode, instrument: preferences.navigationInstrument })
  void startPreferenceSync()
  await initPlatformAuth()
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppDirectionProvider>
        <ThemeProvider>
          <TooltipProvider>
            <ErrorBoundary>
              <AuthGate><App initialPreferences={preferences} /></AuthGate>
            </ErrorBoundary>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </AppDirectionProvider>
    </StrictMode>
  )
}

bootstrap().catch((failure: unknown) => surfaceGlobalError(`bootstrap failed: ${describe(failure)}`))
