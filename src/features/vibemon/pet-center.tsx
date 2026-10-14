import { PetCenter } from "@alwith/module-auth/pets/react"
import { resourceSyncStatus, subscribeResourceSync, syncVibemonResources } from "@alwith/module-auth/pets/core"
import { useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { usePlatformAuth } from "@/features/auth/store"

export function VibemonCenter() {
  const user = usePlatformAuth(state => state.user)
  const status = useSyncExternalStore(subscribeResourceSync, resourceSyncStatus)
  const { t } = useTranslation()
  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden">
      {status === "error" && (
        <Alert className="shrink-0">
          <AlertDescription className="flex items-center justify-between gap-2">
            {t("pet.syncFailed")}
            <Button variant="outline" size="sm" onClick={() => void syncVibemonResources()}>
              {t("pet.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="min-h-0 flex-1">
        <PetCenter key={user?.user_uuid} />
      </div>
    </main>
  )
}
