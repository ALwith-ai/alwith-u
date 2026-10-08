import { getVibemonState, updateVibemonState } from "@alwith/module-vibemon"
import { PetCenter } from "@alwith/module-vibemon/react"
import { PawPrintIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { usePlatformAuth } from "@/features/auth/store"
import { requestPet } from "./transport"

export function VibemonCenter() {
  const { t } = useTranslation()
  const user = usePlatformAuth(state => state.user)
  const [busy, setBusy] = useState(false)
  const action = async (show: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      if (show && !(await getVibemonState()).pet) throw new Error(t("pet.selectFirst"))
      const result = await requestPet<"shown" | "unavailable" | undefined>(show ? "open-pet" : "close-pet")
      if (result === "unavailable") throw new Error(t("pet.unavailable"))
      if (!show) await updateVibemonState({ enabled: false })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="bg-background text-foreground flex shrink-0 justify-end gap-1 border-b p-1">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void action(true)}>
          <PawPrintIcon />
          {t("pet.show")}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void action(false)}>
          <XIcon />
          {t("pet.hide")}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <PetCenter key={user?.user_uuid} />
      </div>
    </main>
  )
}
