// The launcher stays resident, so its page loads only what it shows: no account gate, chat state or
// editor support, which the auxiliary-window bootstrap brings for windows that need them.
import { attachConsole, error as logError } from "@tauri-apps/plugin-log"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { toast } from "sonner"

import { ErrorBoundary } from "@/components/error-boundary"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { LauncherWindow } from "@/features/launcher/launcher-window"
import { initI18n } from "@/lib/i18n"
import { bootstrapSettings, settingsStore } from "@/lib/settings-store"
import "./index.css"

async function bootstrap(): Promise<void> {
  await bootstrapSettings()
  await attachConsole()
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    toast.error(message)
    void logError(`[launcher] ${message}`)
  })
  await initI18n(settingsStore.get<string>("general.language") ?? null)
  const root = document.getElementById("root")
  if (!root) throw new Error("the window page has no #root")
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <ErrorBoundary>
          <LauncherWindow />
        </ErrorBoundary>
        <Toaster position="top-center" />
      </ThemeProvider>
    </StrictMode>
  )
}

void bootstrap().catch((failure: unknown) =>
  logError(`[launcher] bootstrap failed: ${failure instanceof Error ? failure.message : String(failure)}`)
)
