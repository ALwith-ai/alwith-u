import type { Session } from "@alwith/module-chat/client"
import { nativeTurnId } from "@alwith/module-chat/client"
import { ConversationView } from "@alwith/module-chat/conversation"
import { type ReactNode, type RefObject, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"

import type { SessionSummary } from "@/agent/client"
import { CollectionPicker } from "@/features/collection/collection-menu"
import { SessionPreview } from "@/features/computer/session-preview"
import { prepareImageEdit } from "@/features/images/prepare-edit"
import type { VoiceResume } from "@/features/voice/use-voice-handoff"
import { client } from "@/lib/client"

import { ChatActionsMenu } from "./chat-actions-menu"
import { ChatBranchProvider, ForkProgress, ForkTurnButton } from "./chat-branches"
import { ChatHeader } from "./chat-header"
import { useChatHost, useTimelineSlots } from "./chat-host"
import { ChatWelcome } from "./chat-welcome"
import { ChatComposer } from "./composer"
import { useInputMode } from "./composer/input-mode"
import { ChatSearch } from "./dialogs/chat-search"
import { FilePreviewModal } from "./dialogs/file-preview-modal"
import { ImageLightbox } from "./dialogs/image-lightbox"
import { ChatDirectoryContext, ChatOpenSessionContext } from "./file-actions"

type ChatViewProps = {
  session: Session
  voiceResume?: VoiceResume
  onSelectSession?: (sessionRow: SessionSummary) => void
  onOpenWindow?: () => void
  onReturnToMain?: () => void
  headerTarget?: HTMLElement | null
  projectMenu?: ReactNode
  onNewChat: () => void
  onNewProject?: () => void
  onDeleted: (sessionId: string) => void
}

function Conversation({
  session,
  voiceResume,
  onOpenWindow,
  onReturnToMain,
  headerTarget,
  projectMenu,
  onNewChat,
  onNewProject,
  onDeleted,
  rootRef
}: ChatViewProps & { rootRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const inputMode = useInputMode()
  const host = useChatHost(session.id)
  const timeline = useTimelineSlots()
  const lastNativeItem = session.items.findLast((item) => nativeTurnId(item) !== null)
  return (
    <ConversationView
      session={session}
      client={client}
      host={host}
      rootRef={rootRef}
      timeline={timeline}
      header={
        <>
          <ChatHeader
            target={headerTarget}
            title={session.title ?? (session.items.length === 0 ? t("sidebar.newChat") : t("sidebar.untitled"))}
            project={projectMenu}
          >
            <CollectionPicker
              sessionId={session.id}
              favorite
              hoverBackground="control"
              className="transition-colors duration-150 ease-out hover:bg-foreground/8 aria-expanded:bg-foreground/8 dark:hover:bg-foreground/8"
            />
            <ChatActionsMenu
              surface={headerTarget === undefined ? "main" : "floating"}
              onOpenWindow={inputMode?.mode === "image" ? undefined : onOpenWindow}
              onReturnToMain={onReturnToMain}
              session={session}
              cwd={session.cwd}
              onNewChat={onNewChat}
              onNewProject={onNewProject}
              onDeleted={onDeleted}
            />
          </ChatHeader>
          <ForkProgress />
        </>
      }
      overlay={
        <>
          <div
            className="pointer-events-none absolute top-2 right-2 z-20 w-72 max-w-[calc(100%-16px)] [&>*]:pointer-events-auto"
            data-computer-preview-overlay
          >
            <SessionPreview key={session.id} sessionId={session.id} />
          </div>
          <ChatSearch rootRef={rootRef} sessionId={session.id} />
        </>
      }
      readOnlyActions={
        <ForkTurnButton labelled turnId={lastNativeItem === undefined ? null : nativeTurnId(lastNativeItem)} />
      }
      composer={<ChatComposer session={session} voiceResume={voiceResume} />}
      welcome={<ChatWelcome />}
    >
      <FilePreviewModal />
      <ImageLightbox
        sessionId={session.id}
        onSend={async (prompt) => {
          const current = client.state.sessions[session.id]
          if (
            client.state.connection !== "ready" ||
            !current?.attached ||
            current.restoring ||
            current.readOnly ||
            inputMode?.ready === false
          ) {
            throw new Error(t("chat.image.edit.notReady"))
          }
          const selection = inputMode?.mode === "image" ? { ...inputMode.selection } : null
          const meta = {
            alwith: {
              imageIntent: selection ? "edit" : null,
              ...(selection ? { imageSelection: selection } : {})
            }
          }
          const prepared = await prepareImageEdit(prompt, session.id, selection?.model ?? null, meta)
          await client.prompt(session.id, prepared, { meta })
        }}
      />
    </ConversationView>
  )
}

export function ChatView(props: ChatViewProps) {
  const { session, onSelectSession } = props
  const rootRef = useRef<HTMLDivElement>(null)
  // A subagent's session lives in the same Codex home; it opens like any session of this project.
  const openSession = useCallback(
    (sessionId: string, title: string): void =>
      onSelectSession?.({ sessionId, cwd: session.cwd, title, updatedAt: null, archived: false }),
    [onSelectSession, session.cwd]
  )
  return (
    <ChatBranchProvider key={session.id} session={session} onSelect={onSelectSession}>
      <ChatOpenSessionContext value={openSession}>
        {/* Relative links and image paths resolve against the session's directory. */}
        <ChatDirectoryContext value={session.cwd}>
          <Conversation {...props} rootRef={rootRef} />
        </ChatDirectoryContext>
      </ChatOpenSessionContext>
    </ChatBranchProvider>
  )
}
