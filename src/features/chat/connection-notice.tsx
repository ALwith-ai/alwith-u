import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/** Overlay the draft below its 40px header without taking space from the chat. */
export function ConnectionNotice({
  connection,
  error,
  onReconnect
}: {
  connection: string
  error: string | null
  onReconnect: () => Promise<void>
}) {
  const { t } = useTranslation()
  if (connection !== "failed" && connection !== "disconnected") return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-12 z-20 mx-auto w-full max-w-3xl px-6">
      <Alert
        variant="destructive"
        className="pointer-events-auto max-h-[min(40vh,16rem)] overflow-y-auto bg-background shadow-md"
      >
        <AlertTitle>{t(connection === "failed" ? "connection.failed" : "connection.disconnected")}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {error !== null && <span className="min-w-0 break-words font-mono">{error}</span>}
          <Button size="sm" variant="outline" onClick={() => void onReconnect()}>
            {t("connection.reconnect")}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
