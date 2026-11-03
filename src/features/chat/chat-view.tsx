import type { Session } from "@alwith/module-chat/client"
import { nativeTurnId } from "@alwith/module-chat/client"
import { ConversationView } from "@alwith/module-chat/conversation"
import { type ReactNode, type RefObject, useCallback, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useStore } from "zustand"

import type { SessionSummary } from "@/agent/client"
import { isImageSession } from "@/agent/session-kind"
import { CollectionPicker } from "@/features/collection/collection-menu"
import { SessionPreview } from "@/features/computer/session-preview"
import { submitImageEdit } from "@/features/images/edit-session"
import { ImageIcon } from "@/features/images/image-icon"
import { imageConversationPresentation } from "@/features/images/image-presentation"
import type { VoiceResume } from "@/features/voice/use-voice-handoff"
import { client } from "@/lib/client"

import { ChatActionsMenu } from "./chat-actions-menu"
import { ChatBranchProvider, ForkProgress, ForkTurnButton } from "./chat-branches"
import { ChatHeader } from "./chat-header"
import { useChatHost, useTimelineSlots } from "./chat-host"
import { ChatComposer } from "./composer"
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
  onSelectSession,
  onReturnToMain,
  headerTarget,
  projectMenu,
  onNewChat,
  onNewProject,
  onDeleted,
  rootRef
}: ChatViewProps & { rootRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const host = useChatHost(session.id)
  const timeline = useTimelineSlots()
  const imageConversation = useStore(client.store, (state) =>
    [...state.sessionList, ...state.archivedSessions].some((row) => row.sessionId === session.id && isImageSession(row))
  )
  const title = session.title?.trim()
  const imageTitle =
    !title || title === t("sidebar.newChat") || title === "New chat" || title === "新聊天"
      ? t("images.conversationTitle")
      : title
  const lastNativeItem = session.items.findLast((item) => nativeTurnId(item) !== null)
  const presentation = useMemo(
    () => imageConversationPresentation(session, imageConversation),
    [session, imageConversation]
  )
  const attachRoot = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      node?.toggleAttribute("data-image-conversation", imageConversation)
    },
    [rootRef, imageConversation]
  )
  return (
    <ConversationView
      session={presentation}
      client={client}
      host={host}
      rootRef={attachRoot}
      timeline={timeline}
      header={
        <>
          <ChatHeader
            target={headerTarget}
            title={
              imageConversation
                ? imageTitle
                : title || (session.items.length === 0 ? t("sidebar.newChat") : t("sidebar.untitled"))
            }
            project={
              imageConversation ? (
                <span
                  className="inline-flex size-8 shrink-0 items-center justify-center"
                  aria-label={t("images.title")}
                >
                  <ImageIcon className="size-4" />
                </span>
              ) : (
                projectMenu
              )
            }
          >
            {!imageConversation && (
              <CollectionPicker
                sessionId={session.id}
                favorite
                hoverBackground="control"
                className="transition-colors duration-150 ease-out hover:bg-foreground/8 aria-expanded:bg-foreground/8 dark:hover:bg-foreground/8"
              />
            )}
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
    >
      <FilePreviewModal />
      <ImageLightbox
        sessionId={session.id}
        onSend={async (prompt) => {
          if (!imageConversation && !onSelectSession) throw new Error("Image edit navigation is unavailable")
          const source = [...client.state.sessionList, ...client.state.archivedSessions].find(
            (row) => row.sessionId === session.id
          ) ?? { sessionId: session.id, cwd: session.cwd, title: session.title, updatedAt: null, archived: false }
          const target = await submitImageEdit(client, source, prompt, t("chat.image.edit.notReady"))
          if (target.sessionId !== session.id) onSelectSession!(target)
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
