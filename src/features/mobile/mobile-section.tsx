import { listen } from "@tauri-apps/api/event"
import { SmartphoneIcon } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { commands, type MobileBridgeStatus, type PairingInfo, type TrustedDevice } from "@/bindings"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { SettingGroup, SettingLabel, SettingRow } from "@/features/settings/sections/shared"
import { settingsStore } from "@/lib/settings-store"

import { MOBILE_RELAY_URL, mobileEnabled, setMobileEnabled } from "./bridge"

export function MobileSection({ onOpenAccount }: { onOpenAccount?: () => void }) {
  const { t, i18n } = useTranslation()
  const enabled = useSyncExternalStore((notify) => settingsStore.subscribe(notify), mobileEnabled)
  const [status, setStatus] = useState<MobileBridgeStatus | null>(null)
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<TrustedDevice | null>(null)

  useEffect(() => {
    let disposed = false
    let polling = false
    const refresh = async () => {
      if (polling) return
      polling = true
      try {
        const [status, devices] = await Promise.all([commands.mobileBridgeStatus(), commands.bridgeTrustedList()])
        if (!disposed) {
          setStatus(status)
          setDevices(devices)
          setLoaded(true)
          setLoadError(null)
        }
      } catch (error) {
        if (!disposed) {
          setStatus(null)
          setLoadError(String(error))
        }
      } finally {
        polling = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    const stop = listen("bridge:paired", () => {
      if (disposed) return
      setPairing(null)
      setNotice(t("mobile.paired"))
      void refresh()
    })
    return () => {
      disposed = true
      clearInterval(timer)
      void stop.then((stop) => stop())
    }
  }, [t])
  useEffect(() => {
    if (!pairing) return
    const tick = () => {
      const seconds = Math.ceil((pairing.expiresAt - Date.now()) / 1000)
      if (seconds <= 0) {
        setRemaining(0)
      } else setRemaining(seconds)
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [pairing])
  const perform = async (action: () => Promise<void>) => {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (error) {
      setError(String(error))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("mobile.intro")}</p>
      {onOpenAccount && (
        <Button variant="link" className="h-auto rounded-sm p-0" onClick={onOpenAccount}>
          {t("mobile.openAccount")}
        </Button>
      )}
      <SettingGroup>
        <SettingRow title={t("mobile.enable")} desc={t("mobile.description")}>
          <Switch
            checked={enabled}
            disabled={pending}
            aria-label={t("mobile.enable")}
            onCheckedChange={(value) =>
              void perform(async () => {
                await setMobileEnabled(value)
                if (!value) setPairing(null)
                setStatus(await commands.mobileBridgeStatus())
              })
            }
          />
        </SettingRow>
      </SettingGroup>
      {enabled && (
        <SettingGroup>
          <SettingRow
            title={t("mobile.pair")}
            desc={t(status?.relayConnected ? "mobile.connected" : "mobile.connecting")}
          >
            <Button
              className="rounded-sm"
              variant="outline"
              disabled={pending || !status?.relayConnected}
              onClick={() =>
                void perform(async () => {
                  const next = await commands.bridgePairingStart()
                  setRemaining(Math.max(0, Math.ceil((next.expiresAt - Date.now()) / 1000)))
                  setPairing(next)
                })
              }
            >
              {t(pairing ? "mobile.refresh" : "mobile.generate")}
            </Button>
          </SettingRow>
          {!status?.relayConnected && (
            <Button
              className="rounded-sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void perform(async () => {
                  await setMobileEnabled(true)
                  setStatus(await commands.mobileBridgeStatus())
                })
              }
            >
              {t("mobile.reconnect")}
            </Button>
          )}
          {pairing && (
            <div className="flex flex-col items-center gap-3 px-4 py-5 text-center">
              <p className="text-sm">{t("mobile.scanHint")}</p>
              {remaining > 0 && status?.relayConnected ? (
                <QRCodeSVG
                  size={200}
                  marginSize={4}
                  bgColor="transparent"
                  fgColor="currentColor"
                  value={JSON.stringify({
                    relayUrl: MOBILE_RELAY_URL,
                    deviceId: pairing.deviceId,
                    publicKeyB64: pairing.publicKeyB64,
                    code: pairing.code,
                    hostApp: pairing.hostApp
                  })}
                />
              ) : null}
              <p role="status" className="text-sm text-muted-foreground">
                {t(
                  remaining <= 0 ? "mobile.expired" : status?.relayConnected ? "mobile.expires" : "mobile.connecting",
                  { count: remaining }
                )}
              </p>
            </div>
          )}
        </SettingGroup>
      )}
      <section>
        <SettingLabel>{t("mobile.devices")}</SettingLabel>
        <p className="mb-3 text-xs text-muted-foreground">{t("mobile.devicesHint")}</p>
        {devices.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t(!loaded ? (loadError ? "mobile.loadFailed" : "mobile.loading") : "mobile.empty")}
          </p>
        ) : (
          <ul className="space-y-3" aria-label={t("mobile.devices")}>
            {devices.map((device) => (
              <li
                key={device.deviceId}
                className="flex items-start gap-3 rounded-xl border bg-card p-4 text-card-foreground"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <SmartphoneIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium break-words">{device.name || device.model || t("mobile.phone")}</p>
                  <p className="text-xs break-words text-muted-foreground">
                    {[device.model && device.model !== device.name ? device.model : null, device.deviceId.slice(-8)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("mobile.pairedAt", {
                      date: new Date(device.pairedAt).toLocaleString(i18n.language)
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-sm text-muted-foreground"
                  disabled={pending}
                  onClick={() => setRevoking(device)}
                >
                  {t("mobile.unpair")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {(error || loadError) && (
        <p role="alert" className="text-sm text-muted-foreground">
          {error || loadError}
        </p>
      )}
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setRevoking(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("mobile.revokeTitle", {
                name: revoking?.name || revoking?.model || t("mobile.phone")
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("mobile.revokeHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button className="rounded-sm" variant="outline" disabled={pending} onClick={() => setRevoking(null)}>
              {t("mobile.cancel")}
            </Button>
            <Button
              className="rounded-sm"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!revoking) return
                const device = revoking
                void perform(async () => {
                  await commands.bridgeTrustedRevoke({
                    deviceId: device.deviceId
                  })
                  setDevices((devices) => devices.filter((item) => item.deviceId !== device.deviceId))
                  setRevoking(null)
                  setNotice(t("mobile.unpaired"))
                })
              }}
            >
              {t("mobile.unpair")}
            </Button>
          </AlertDialogFooter>
          {error && (
            <p role="alert" className="text-sm text-muted-foreground">
              {error}
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
