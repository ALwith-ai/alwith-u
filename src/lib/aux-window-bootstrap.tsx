// The one bootstrap for auxiliary windows (ALwith Desktop's aux-window-bootstrap): the
// same providers the main window mounts, minus the App and its Runtime connection.
import { attachConsole, error as logError } from "@tauri-apps/plugin-log"
import { type ComponentType, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"
import { AppDirectionProvider } from "@/components/alwith-ui/app-direction-provider"
import { ErrorBoundary } from "@/components/error-boundary"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthGate } from "@/features/auth/auth-gate"
import { initPlatformAuth } from "@/features/auth/store"
import { hydrateNavigationSound } from "@/features/chat/codex/navigation-sound-store"
import { initI18n } from "@/lib/i18n"
import { startPreferenceSync } from "@/lib/preference-sync"
import { loadPreferences, type Preferences } from "@/lib/preferences"
import { hydrateZoom } from "@/lib/zoom"
import "../index.css"

export function bootstrapAuxWindow(opts: {
  component: ComponentType<{ preferences: Preferences }>
  logTag: string
  toaster?: boolean
  setup?: () => Promise<void>
  transparent?: boolean
}): void {
  const Component = opts.component
  async function bootstrap() {
    await attachConsole()
    window.addEventListener("unhandledrejection", event => {
      const error: unknown = event.reason
      const message = error instanceof Error ? error.message : String(error)
      toast.error(message)
      void logError(`[${opts.logTag}] ${message}`).catch((failure: unknown) => console.error(failure))
    })
    const preferences = await loadPreferences()
    await initI18n(preferences.language)
    await hydrateZoom(preferences.zoomLevel)
    hydrateNavigationSound({ soundMode: preferences.navigationSoundMode, instrument: preferences.navigationInstrument })
    void startPreferenceSync()
    await initPlatformAuth()
    await opts.setup?.()
    if (opts.transparent) {
      document.documentElement.style.background = "transparent"
      document.body.style.background = "transparent"
    }
    const root = document.getElementById("root")
    if (!root) throw new Error("the window page has no #root")
    createRoot(root).render(
      <StrictMode>
        <AppDirectionProvider>
          <ThemeProvider>
            <TooltipProvider>
              <ErrorBoundary>
                <AuthGate auxiliary>
                  <Component preferences={preferences} />
                </AuthGate>
              </ErrorBoundary>
              {opts.toaster ? <Toaster position="top-center" /> : null}
            </TooltipProvider>
          </ThemeProvider>
        </AppDirectionProvider>
      </StrictMode>
    )
  }
  bootstrap().catch((failure: unknown) =>
    logError(`[${opts.logTag}] bootstrap failed: ${failure instanceof Error ? failure.message : String(failure)}`)
  )
}
