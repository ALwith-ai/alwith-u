import { LockIcon, PictureInPicture2Icon } from "lucide-react"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { PendingAction } from "@/agent/client"
import type { Session } from "@alwith/api"
import { isFormElicitation } from "@alwith/api"
import { client, useApp } from "@/lib/client"
import { ActionCard } from "./action-card"
import { ChatBody } from "./chat-body"
import { Composer } from "./composer"
import { ChatSearch } from "./dialogs/chat-search"
import { DiffModal } from "./dialogs/diff-modal"
import { ElicitationFormDialog, type FormAction } from "./dialogs/elicitation-form-dialog"
import { ImageLightbox } from "./dialogs/image-lightbox"
import { ProjectMenu } from "./open-in-editor"

function isFormAction(action: PendingAction): action is FormAction {
  return action.kind === "elicitation" && isFormElicitation(action.params)
}

export function ChatView({ session, onOpenWindow }: { session: Session; onOpenWindow?: () => void }) {
  const { t } = useTranslation()
  const actions = useApp(useShallow(state => state.actions.filter(action => action.sessionId === session.id)))
  // Form elicitations are answered one at a time in a modal; everything else stays inline.
  const forms = actions.filter(isFormAction)
  const inline = actions.filter(action => !isFormAction(action))
  const rootRef = useRef<HTMLDivElement>(null)
  const reopen = () => {
    client
      .open(session.id, session.cwd)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <header className="relative flex h-12 shrink-0 items-center gap-3 px-4" data-tauri-drag-region>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" data-tauri-drag-region>
            {session.title ?? t("sidebar.untitled")}
          </div>
          <ProjectMenu cwd={session.cwd} />
        </div>
        <ChatSearch rootRef={rootRef} />
        {onOpenWindow && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("chatWindow.open")}
            aria-label={t("chatWindow.open")}
            onClick={onOpenWindow}>
            <PictureInPicture2Icon />
          </Button>
        )}
      </header>
      {session.readOnly && (
        <div className="px-4 pb-2">
          <Alert>
            <LockIcon />
            <AlertTitle>{t("chat.readOnly.title")}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {t("chat.readOnly.description")}
              <Button size="sm" variant="outline" onClick={reopen}>
                {t("chat.readOnly.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}
      <ChatBody session={session} />
      {inline.length > 0 && (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pb-3">
          {inline.map(action => (
            <ActionCard key={action.id} action={action} />
          ))}
        </div>
      )}
      <Composer session={session} />
      {forms[0] !== undefined && <ElicitationFormDialog key={forms[0].id} action={forms[0]} total={forms.length} />}
      <DiffModal />
      <ImageLightbox />
    </div>
  )
}
