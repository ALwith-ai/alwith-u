import type { Session } from "@alwith/api"
import { LockIcon, UnplugIcon } from "lucide-react"
import { type ReactNode, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { ThreadSummary } from "@/agent/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { SessionPreview } from "@/features/computer/session-preview"
import type { VoiceResume } from "@/features/voice/use-voice-handoff"
import { client, useApp } from "@/lib/client"

import { ChatActionsMenu } from "./chat-actions-menu"
import { ChatBody } from "./chat-body"
import { ChatBranchProvider } from "./chat-branches"
import { ChatHeader } from "./chat-header"
import { Composer } from "./composer"
import { ChatSearch } from "./dialogs/chat-search"
import { DiffModal } from "./dialogs/diff-modal"
import { FilePreviewModal } from "./dialogs/file-preview-modal"
import { ImageLightbox } from "./dialogs/image-lightbox"
import { ChatOpenSessionContext } from "./file-actions"
import { SessionActions } from "./session-actions"

export function ChatView({
  session,
  voiceResume,
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
  voiceResume?: VoiceResume
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
  const connected = useApp((state) => state.connection === "ready")
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
          <div className="relative flex min-h-0 flex-1 flex-col" data-chat-content>
            <div
              className="pointer-events-none absolute top-0 right-0 z-20 w-72 max-w-full [&>*]:pointer-events-auto"
              data-computer-preview-overlay
            >
              <SessionPreview key={session.id} sessionId={session.id} />
            </div>
            <ChatSearch rootRef={rootRef} sessionId={session.id} />
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
            <SessionActions sessionId={session.id} />
            <Composer session={session} voiceResume={voiceResume} />
          </div>
          <DiffModal />
          <FilePreviewModal />
          <ImageLightbox />
        </div>
      </ChatOpenSessionContext>
    </ChatBranchProvider>
  )
}
