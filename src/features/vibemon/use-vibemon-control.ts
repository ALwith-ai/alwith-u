import { accountKey } from "@alwith/module-auth/pets"
import { getVibemonState, refreshSettings, vibemonHost } from "@alwith/module-vibemon"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { usePlatformAuth } from "@/features/auth/store"

export function useVibemonControl() {
  const { t } = useTranslation()
  const userId = usePlatformAuth(state => state.user?.user_uuid ?? null)
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)

  useEffect(() => {
    setLoaded(false)
    if (userId === null) return
    const host = vibemonHost()
    let revision = 0
    let disposed = false
    const refresh = async () => {
      const expected = ++revision
      const account = host.account()
      const accounts = await host.storage.get<Record<string, { enabled: boolean }>>("vibemon.accounts")
      if (disposed || expected !== revision) return
      setEnabled(account !== null && (accounts?.[accountKey(account)]?.enabled ?? false))
      setLoaded(true)
    }
    const changed = () => void refresh().catch(host.onError)
    const stop = host.subscribeStorage(changed)
    changed()
    return () => {
      disposed = true
      stop()
    }
  }, [userId])

  const toggle = async () => {
    if (pending.current || !loaded) return
    pending.current = true
    setBusy(true)
    try {
      const host = vibemonHost()
      await refreshSettings()
      const state = await getVibemonState()
      if (state.enabled) await host.windows.closePet()
      else {
        if (!state.pet) throw new Error(t("pet.selectFirst"))
        if ((await host.windows.openPet()) === "unavailable") throw new Error(t("pet.unavailable"))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return { enabled, disabled: busy || !loaded, toggle }
}
