import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { LoaderCircleIcon, Minimize2Icon } from "lucide-react"
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
import { requestChatSurface } from "@/lib/chat-window"
import { petErrorMessage } from "./display-error"
import { collapseChatToPet } from "./window-client"

type Notice = { type: "setup"; view: "pull" | "equip"; error?: string } | { type: "error"; error: string }

export function ChatWindowPetButton({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const operation = useRef<AbortController | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: A session change must abort the previous operation and clear its notice.
  useEffect(() => {
    setNotice(null)
    setNoticeOpen(false)
    setBusy(false)
    const stop = getCurrentWebviewWindow().onCloseRequested(() => operation.current?.abort())
    return () => {
      operation.current?.abort()
      operation.current = null
      void stop.then(unlisten => unlisten())
    }
  }, [sessionId])
  const collapse = async () => {
    if (operation.current !== null) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    try {
      const result = await collapseChatToPet(sessionId, controller.signal)
      if (!controller.signal.aborted) {
        if (result.type === "setup") setNotice(result)
        setNoticeOpen(result.type === "setup")
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setNotice({ type: "error", error: petErrorMessage(failure) })
        setNoticeOpen(true)
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null
        setBusy(false)
      }
    }
  }
  const openSetup = async (view: "pull" | "equip") => {
    if (operation.current !== null) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    try {
      await requestChatSurface("main", { type: "vibemon", view })
      if (!controller.signal.aborted) setNoticeOpen(false)
    } catch (failure) {
      if (!controller.signal.aborted) setNotice({ type: "setup", view, error: petErrorMessage(failure) })
    } finally {
      if (operation.current === controller) {
        operation.current = null
        setBusy(false)
      }
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t("pet.collapse")}
        aria-label={t("pet.collapse")}
        disabled={busy}
        onClick={() => void collapse()}>
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <Minimize2Icon />}
      </Button>
      <Dialog open={noticeOpen} onOpenChange={open => !busy && setNoticeOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(notice?.type === "setup" ? "pet.setupTitle" : "common:petMode.failed")}</DialogTitle>
            <DialogDescription>
              {notice?.type === "setup"
                ? t(notice.view === "pull" ? "common:petMode.drawHint" : "common:petMode.equipHint")
                : notice?.error}
            </DialogDescription>
          </DialogHeader>
          {notice?.type === "setup" && notice.error && (
            <p role="alert" className="text-destructive text-sm">
              {notice.error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setNoticeOpen(false)}>
              {t(notice?.type === "setup" ? "actions.cancel" : "actions.close")}
            </Button>
            {notice?.type === "setup" && (
              <Button disabled={busy} onClick={() => void openSetup(notice.view)}>
                {t(notice.view === "pull" ? "common:petMode.goDraw" : "common:petMode.goEquip")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
