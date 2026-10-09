import { PetModeButton } from "@alwith/module-vibemon/react"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { collapseChatToPet } from "./window-client"

export function ChatWindowPetButton({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation("common")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => {
    const stop = getCurrentWebviewWindow().onCloseRequested(() => operation.current?.abort())
    return () => {
      operation.current?.abort()
      void stop.then(unlisten => unlisten())
    }
  }, [])
  const collapse = async () => {
    if (operation.current !== null) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    try {
      await collapseChatToPet(sessionId, controller.signal)
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (operation.current === controller) {
        operation.current = null
        setBusy(false)
      }
    }
  }
  return (
    <>
      <PetModeButton busy={busy} onClick={() => void collapse()} />
      <Dialog
        open={error !== null}
        onOpenChange={open => {
          if (!open) setError(null)
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("petMode.failed")}</DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setError(null)}>{t("close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
