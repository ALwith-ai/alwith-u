import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { openUrl } from "@tauri-apps/plugin-opener"
import { platform } from "@tauri-apps/plugin-os"
import { XIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { GamepadSettings } from "./gamepad"
import { GAMEPAD_SOCIAL_LINKS } from "./social-links"
import { useMainWindowVisible } from "./use-main-window-visible"
import { WindowFrameIcon } from "./window-frame-icon"

function report(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}
async function showMain(): Promise<void> {
  await commands.showMainWindow()
}

// Desktop's auxiliary shell: 32px title bar, full-height content, 32px footer.
export function GamepadWindow(): ReactNode {
  const { t } = useTranslation()
  const mainVisible = useMainWindowVisible(report)
  return (
    <div
      className="flex h-screen flex-col bg-background text-foreground"
      style={{ fontFamily: "system-ui, sans-serif" }}>
      <header className="relative flex h-8 shrink-0 items-center justify-end px-2" data-tauri-drag-region>
        <span className="absolute start-1/2 flex -translate-x-1/2 items-center gap-1.5 text-[13px] font-semibold text-muted-foreground rtl:translate-x-1/2">
          🎮 ALwith Gamepad
          <Badge className="bg-primary/15 text-[10px] text-primary uppercase">Beta</Badge>
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-pressed={mainVisible}
          className={`group shrink-0 hover:bg-transparent dark:hover:bg-transparent ${mainVisible ? "text-ring hover:text-ring" : "text-muted-foreground hover:text-muted-foreground"}`}
          title={t("sidebar.backToMain")}
          aria-label={t("sidebar.backToMain")}
          onClick={() => void showMain().catch(report)}>
          <WindowFrameIcon />
        </Button>
        {platform() === "windows" && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent"
            title={t("common.close")}
            aria-label={t("common.close")}
            onClick={() => void getCurrentWebviewWindow().close().catch(report)}>
            <XIcon className="size-4" />
          </Button>
        )}
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-auto">
        <GamepadSettings />
      </main>
      <footer className="relative flex h-8 shrink-0 items-center justify-end px-2">
        <p className="absolute start-1/2 -translate-x-1/2 text-xs text-muted-foreground rtl:translate-x-1/2">
          © 2026{" "}
          <button
            type="button"
            className="underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => void openUrl("https://alwith.ai").catch(report)}>
            ALwith.ai
          </button>
        </p>
        <div className="flex items-center gap-1">
          {GAMEPAD_SOCIAL_LINKS.map(link => (
            <Button
              key={link.name}
              variant="ghost"
              size="icon-sm"
              className="size-[22px] shrink-0 rounded text-[var(--social-base)] hover:bg-transparent hover:text-[var(--social-brand)] dark:hover:bg-transparent dark:hover:text-[var(--social-brand-dark)]"
              style={
                {
                  "--social-base": "var(--muted-foreground)",
                  "--social-brand": link.hex,
                  "--social-brand-dark": link.hexDark
                } as CSSProperties
              }
              title={link.name}
              aria-label={link.name}
              onClick={() => void openUrl(link.url).catch(report)}>
              <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden="true">
                <path d={link.path} />
              </svg>
            </Button>
          ))}
        </div>
      </footer>
    </div>
  )
}
