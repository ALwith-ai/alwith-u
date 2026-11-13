import { resourceSyncStatus, subscribeResourceSync, syncVibemonResources } from "@alwith/module-auth/vibemon/core"
import { VibemonCenter as SharedVibemonCenter } from "@alwith/module-auth/vibemon/react"
import { useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { ErrorBoundary } from "@/components/error-boundary"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { usePlatformAuth } from "@/features/auth/store"

export function VibemonCenter() {
  const user = usePlatformAuth((state) => state.user)
  const [attempt, setAttempt] = useState(0)
  const { t } = useTranslation("vibemon")
  return (
    <ErrorBoundary
      key={`${user?.user_uuid ?? "signed-out"}/${attempt}`}
      fallback={
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6">
          <p>{t("offline.title")}</p>
          <p className="text-sm text-muted-foreground">{t("offline.description")}</p>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {t("offline.retry")}
          </Button>
        </div>
      }
    >
      <VibemonContent />
    </ErrorBoundary>
  )
}

function VibemonContent() {
  const status = useSyncExternalStore(subscribeResourceSync, resourceSyncStatus)
  const { t } = useTranslation()
  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {status === "error" && (
        <Alert className="shrink-0">
          <AlertDescription className="flex items-center justify-between gap-2">
            {t("vibemon.syncFailed")}
            <Button variant="outline" size="sm" onClick={() => void syncVibemonResources()}>
              {t("vibemon.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="vibemon-content relative min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        <SharedVibemonCenter />
      </div>
    </main>
  )
}
