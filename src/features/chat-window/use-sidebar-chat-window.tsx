import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { openChatWindow, requestChatSurface } from "@/lib/chat-window"
import { useChatWindowSurface } from "@/lib/chat-window-state"
import { client } from "@/lib/client"

/** The sidebar opens drafts directly and confirms replacing a visible conversation. */
export function useSidebarChatWindow() {
  const { t } = useTranslation()
  const [target, setTarget] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const working = useRef(false)
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (working.current) return
    working.current = true
    setPending(true)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      working.current = false
      setPending(false)
    }
  }
  const open = (): void => {
    if (target !== null) return
    void run(async () => {
      const window = await WebviewWindow.getByLabel("chat")
      if (window !== null && (await window.isVisible())) {
        const { sessionId } = useChatWindowSurface.getState()
        if (sessionId !== null && client.state.draftSessions[sessionId] !== "chat") {
          if (client.state.sessionWindows[sessionId] !== "chat") throw new Error("The chat window conversation changed")
          setTarget(sessionId)
          return
        }
      }
      await openChatWindow()
    })
  }
  const confirm = (): void => {
    if (target === null) return
    void run(async () => {
      if ((await WebviewWindow.getByLabel("chat")) === null) throw new Error("The chat window has closed")
      await requestChatSurface("chat", { type: "present", newChatFor: target })
      setTarget(null)
    })
  }
  const confirmation = (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && !working.current && setTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("chatWindow.newChatTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("chatWindow.newChatDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => setTarget(null)}>
            {t("actions.cancel")}
          </Button>
          <Button disabled={pending} onClick={confirm}>
            {t("actions.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return { open, confirmation }
}
