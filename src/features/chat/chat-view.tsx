import type { Session } from "@alwith/api"
import { isFormElicitation } from "@alwith/api"
import { LockIcon, UnplugIcon } from "lucide-react"
import { type ReactNode, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"

import type { PendingAction, ThreadSummary } from "@/agent/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ComputerControl } from "@/features/computer/computer-control"
import { SessionPreview } from "@/features/computer/session-preview"
import { client, useApp } from "@/lib/client"

import { ActionCard } from "./action-card"
import { ChatActionsMenu } from "./chat-actions-menu"
import { ChatBody } from "./chat-body"
import { ChatBranchProvider } from "./chat-branches"
import { ChatHeader } from "./chat-header"
import { Composer } from "./composer"
import { ChatSearch } from "./dialogs/chat-search"
import { DiffModal } from "./dialogs/diff-modal"
import { ElicitationFormDialog, type FormAction } from "./dialogs/elicitation-form-dialog"
import { FilePreviewModal } from "./dialogs/file-preview-modal"
import { ImageLightbox } from "./dialogs/image-lightbox"
import { ChatOpenSessionContext } from "./file-actions"

function isFormAction(action: PendingAction): action is FormAction {
  return action.kind === "elicitation" && isFormElicitation(action.params)
}

export function ChatView({
  session,
  onOpenWindow,
  onReturnToMain,
  headerTarget,
  projectMenu,
  onNewChat,
  onNewProject,
  onDeleted,
  onSelectThread
}: {
  session: Session
  onSelectThread?: (thread: ThreadSummary) => void
  onOpenWindow?: () => void
  onReturnToMain?: () => void
  headerTarget?: HTMLElement | null
  projectMenu?: ReactNode
  onNewChat: () => void
  onNewProject?: () => void
  onDeleted: (sessionId: string) => void
}) {
  const { t } = useTranslation()
  const actions = useApp(useShallow((state) => state.actions.filter((action) => action.sessionId === session.id)))
  const connected = useApp((state) => state.connection === "ready")
  // Form elicitations are answered one at a time in a modal; everything else stays inline.
  const forms = actions.filter(isFormAction)
  const inline = actions.filter((action) => !isFormAction(action))
  const rootRef = useRef<HTMLDivElement>(null)
  const reopen = () => {
    client
      .open(session.id, session.cwd)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  // A subagent's thread lives in the same Codex home; it opens like any thread of this project.
  const openSession = useCallback(
    (sessionId: string, title: string): void =>
      onSelectThread?.({ sessionId, cwd: session.cwd, title, updatedAt: null, archived: false }),
    [onSelectThread, session.cwd]
  )
  return (
    <ChatBranchProvider key={session.id} session={session} onSelect={onSelectThread}>
      <ChatOpenSessionContext value={openSession}>
        <div data-chat-drop-zone ref={rootRef} className="flex h-full min-h-0 flex-col">
          <ChatHeader
            target={headerTarget}
            title={session.title ?? (session.items.length === 0 ? t("sidebar.newChat") : t("sidebar.untitled"))}
            project={projectMenu}
          >
            {headerTarget !== undefined && <ComputerControl />}
            <ChatActionsMenu
              surface={headerTarget === undefined ? "main" : "floating"}
              onOpenWindow={onOpenWindow}
              onReturnToMain={onReturnToMain}
              session={session}
              cwd={session.cwd}
              onNewChat={onNewChat}
              onNewProject={onNewProject}
              onDeleted={onDeleted}
            />
          </ChatHeader>
          <ChatSearch rootRef={rootRef} sessionId={session.id} />
          <SessionPreview key={session.id} sessionId={session.id} />
          {connected && !session.attached && !session.restoring && (
            <div className="px-4 pb-2">
              <Alert>
                <UnplugIcon />
                <AlertTitle>{t("chat.stopped")}</AlertTitle>
                <AlertDescription>
                  <Button size="sm" variant="outline" onClick={reopen}>
                    {t("connection.reconnect")}
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {session.readOnly && (
            <div className="px-4 pb-2">
              <Alert>
                <LockIcon />
                <AlertTitle>{t("chat.readOnly.title")}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  {t("chat.readOnly.description")}
                  <Button size="sm" variant="outline" onClick={reopen} disabled={!connected || session.restoring}>
                    {t(session.restoring ? "chat.restoring" : "chat.readOnly.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {session.items.length === 0 && session.attached && !session.restoring && session.state === "idle" ? (
            // A draft session (Desktop semantics): live Codex session, nothing said yet.
            <Empty className="flex-1">
              <EmptyHeader>
                <EmptyTitle>{t("welcome.title")}</EmptyTitle>
                <EmptyDescription>{t("welcome.description")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ChatBody session={session} />
          )}
          {inline.length > 0 && (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pb-3">
              {inline.map((action) => (
                <ActionCard key={action.id} action={action} />
              ))}
            </div>
          )}
          <Composer session={session} />
          {forms[0] !== undefined && <ElicitationFormDialog key={forms[0].id} action={forms[0]} total={forms.length} />}
          <DiffModal />
          <FilePreviewModal />
          <ImageLightbox />
        </div>
      </ChatOpenSessionContext>
    </ChatBranchProvider>
  )
}
