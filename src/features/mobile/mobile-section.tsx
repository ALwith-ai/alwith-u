import { listen } from "@tauri-apps/api/event"
import { QRCodeSVG } from "qrcode.react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { commands, type MobileBridgeStatus, type PairingInfo, type TrustedDevice } from "@/bindings"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { SettingGroup, SettingRow } from "@/features/settings/sections/shared"
import { settingsStore } from "@/lib/settings-store"

import { MOBILE_RELAY_URL, mobileEnabled, setMobileEnabled } from "./bridge"

export function MobileSection() {
  const { t } = useTranslation()
  const enabled = useSyncExternalStore((notify) => settingsStore.subscribe(notify), mobileEnabled)
  const [status, setStatus] = useState<MobileBridgeStatus | null>(null)
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          setError(null)
        }
      } catch (error) {
        if (!disposed) {
          setStatus(null)
          setError(String(error))
        }
      } finally {
        polling = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    const stop = listen("bridge:paired", () => {
      setPairing(null)
      void refresh()
    })
    return () => {
      disposed = true
      clearInterval(timer)
      void stop.then((stop) => stop())
    }
  }, [])
  useEffect(() => {
    if (!pairing) return
    const tick = () => {
      const seconds = Math.ceil((pairing.expiresAt - Date.now()) / 1000)
      if (seconds <= 0) {
        setPairing(null)
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
              disabled={pending || !status?.relayConnected}
              onClick={() => void perform(async () => setPairing(await commands.bridgePairingStart()))}
            >
              {t("mobile.generate")}
            </Button>
          </SettingRow>
          {pairing && (
            <div className="space-y-3 py-4">
              <p>ALwith U</p>
              <QRCodeSVG
                size={200}
                value={JSON.stringify({
                  relayUrl: MOBILE_RELAY_URL,
                  deviceId: pairing.deviceId,
                  publicKeyB64: pairing.publicKeyB64,
                  code: pairing.code,
                  hostApp: pairing.hostApp
                })}
              />
              <p>{t("mobile.expires", { count: remaining })}</p>
            </div>
          )}
        </SettingGroup>
      )}
      {devices.length > 0 && (
        <SettingGroup>
          {devices.map((device) => (
            <SettingRow key={device.deviceId} title={device.model ?? device.name} desc={device.name}>
              <Button
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    await commands.bridgeTrustedRevoke({ deviceId: device.deviceId })
                    setDevices(await commands.bridgeTrustedList())
                  })
                }
              >
                {t("mobile.unpair")}
              </Button>
            </SettingRow>
          ))}
        </SettingGroup>
      )}
      {error && (
        <p role="alert" className="text-sm text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  )
}
