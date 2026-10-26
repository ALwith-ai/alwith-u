import { ALWITH_EXTENSION_ID, BRIDGE_PING_URL, type BrowserBridgeHost, useBrowserBridge } from "@alwith/module-browser"
import { fetch as httpFetch } from "@tauri-apps/plugin-http"
import { ExternalLinkIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { openExternal } from "@/lib/open"
import { cn } from "@/lib/utils"

import { WindowCard } from "./window-card"

const nativeHost: BrowserBridgeHost = {
  extensionInstalled: () => commands.chromeExtensionInstalled(),
  bridgeInstalled: () => commands.chromeBridgeInstalled(),
  ping: async (signal) => (await httpFetch(BRIDGE_PING_URL, { method: "GET", connectTimeout: 1500, signal })).ok,
  setEnabled: async (enabled) => {
    await commands.setChromeBridgeEnabled({ enabled })
  }
}

/** Desktop's browser guide, using the shared native registration and polling capability. */
export function BrowserBridgeCard({
  title,
  icon,
  onOpen,
  active,
  host = nativeHost
}: {
  title: string
  icon: ReactNode
  onOpen: () => void
  active: boolean
  host?: BrowserBridgeHost
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { state, busy, error, recheck, setEnabled } = useBrowserBridge(host, active || open)
  const { installed, connected, registered } = state
  const body = !installed ? "none" : connected ? "connected" : registered ? "restart" : "installed"
  const dot = (on: boolean) => cn("size-2 shrink-0 rounded-full", on ? "bg-green-500" : "bg-muted-foreground/40")
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <WindowCard
        title={title}
        icon={icon}
        onOpen={onOpen}
        badge={
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                aria-label={t("chromeBridge.enableBridge")}
                className="absolute right-2 bottom-1.5 z-10 h-auto gap-1 rounded-full bg-muted px-1.5 py-1"
              />
            }
          >
            <span className={dot(installed)} />
            <span className={dot(connected)} />
          </PopoverTrigger>
        }
      />
      <PopoverContent side="left" align="start" className="w-64" aria-label={title}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span aria-hidden className={dot(installed)} />
              <span className="text-sm">{t(installed ? "chromeBridge.extOn" : "chromeBridge.extOff")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span aria-hidden className={dot(connected)} />
              <span className="text-sm">{t(connected ? "chromeBridge.bridgeOn" : "chromeBridge.bridgeOff")}</span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t(`chromeBridge.${body}Body`)}</p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">{t("chromeBridge.enableBridge")}</span>
              <Switch
                aria-label={t("chromeBridge.enableBridge")}
                checked={registered}
                disabled={busy}
                onCheckedChange={(value) => void setEnabled(value)}
              />
            </div>
            {!installed && (
              <Button
                size="sm"
                onClick={() =>
                  void openExternal(`https://chromewebstore.google.com/detail/${ALWITH_EXTENSION_ID}`).catch(
                    (reason: unknown) => toast.error(String(reason))
                  )
                }
              >
                {t("chromeBridge.install")}
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => void recheck()}>
                {t("chromeBridge.recheck")}
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={onOpen}>
                {t("chromeBridge.bringToFront")}
                <ExternalLinkIcon />
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
