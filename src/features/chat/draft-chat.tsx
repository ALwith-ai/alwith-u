// A draft owns a real ACP session before the first send, as in Desktop.
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { drafts, importDraft, ModelMenu, SessionActions } from "@alwith/module-chat/conversation"
import { createSession } from "@nyssance/codex-acp-v2/client"
import { invoke } from "@tauri-apps/api/core"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import type { DraftOwner } from "@/agent/client"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { dispatchCollection, reportCollection } from "@/features/collection/store"
import { client, useApp, useSession } from "@/lib/client"
import type { ProviderSnapshot } from "@/lib/providers"
import { applyProvidersWhenIdle } from "@/lib/providers"
import { text } from "@/lib/text"

import { ChatActionsMenu } from "./chat-actions-menu"
import { ChatHeader } from "./chat-header"
import { ChatHostProvider } from "./chat-host"
import { ChatComposer } from "./composer"
import { DraftModelSelect } from "./composer/draft-model-select"
import { chatModelMenu } from "./composer/model-catalog"
import { FilePreviewModal } from "./dialogs/file-preview-modal"
import { DraftProjectPicker } from "./draft-project-picker"

export const DRAFT_SESSION_ID = "draft"

function isAuthError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === -32000
}

export function DraftChat({
  owner,
  cwd,
  onCwdChange,
  onCreated,
  collectionId,
  onSendingChange,
  onVoiceHandoff,
  onAuthRequired,
  providerSnapshot,
  onOpenWindow,
  onReturnToMain,
  runOperation,
  headerTarget,
  projectMenu,
  onNewChat,
  onNewProject
}: {
  owner: DraftOwner
  cwd: string | null
  onCwdChange: (cwd: string | null) => void
  /** Bind the precreated session to this surface without materializing a history entry. */
  onCreated: (sessionId: string) => void
  collectionId?: string
  /** Hold this composer only while its own first send is waiting for acceptance. */
  onSendingChange: (sessionId: string, sending: boolean) => void
  onVoiceHandoff?: (sessionId: string, receipt: string) => void
  onAuthRequired: () => void
  providerSnapshot: ProviderSnapshot | null
  runOperation?: (operation: () => Promise<void>) => Promise<void>
  onOpenWindow?: () => void
  onReturnToMain?: () => void
  headerTarget?: HTMLElement | null
  projectMenu?: ReactNode
  onNewChat: () => void
  onNewProject?: () => void
}) {
  const { t } = useTranslation()
  const sessionRows = useApp((state) => state.sessionList)
  const connection = useApp((state) => state.connection)
  const [id, setId] = useState<string | null>(
    () => Object.keys(client.state.draftSessions).find((key) => client.state.draftSessions[key] === owner) ?? null
  )
  const session = useSession(id)
  // Local input exists before ACP does; this detached view never enters the client store.
  const pendingComposer = useMemo(() => createSession(DRAFT_SESSION_ID, cwd ?? ""), [cwd])
  const [preparing, setPreparing] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [model, setModel] = useState<string | null>(null)
  const callbacks = useRef({ onCwdChange, onCreated })
  callbacks.current = { onCwdChange, onCreated }
  const currentId = useRef(id)
  currentId.current = id
  const mounted = useRef(false)
  const preparation = useRef<Promise<string | null> | null>(null)
  const context = useRef({ owner, cwd })
  context.current = { owner, cwd }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const providerRevision = providerSnapshot?.revision
  const recentProjects = useMemo(
    () => [
      ...new Set(
        [...sessionRows]
          .toSorted((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
          .map((sessionRow) => sessionRow.cwd)
      )
    ],
    [sessionRows]
  )

  useEffect(() => {
    // Explicit retries and provider revisions invalidate preparation.
    void attempt
    void providerRevision
    void providerSnapshot?.status
    let active = true
    setPreparing(true)
    setError(null)
    const pending = (async (): Promise<string | null> => {
      await client.connect()
      const directory =
        cwd === null
          ? (await client.refreshProjectContext(true)).chatDirectory
          : await invoke<string>("draft_directory", { cwd })
      await applyProvidersWhenIdle()
      if (!active) return null
      const current = currentId.current
      // Normalizing the default directory may rerun this effect after the first
      // prompt has materialized its session. Keep that conversation selected.
      if (current !== null && client.state.sessions[current]?.cwd === directory && !client.state.draftSessions[current])
        return current
      const next = await client.prepareDraft(owner, cwd === null ? undefined : directory, model)
      const previous = currentId.current
      if (previous !== next) {
        const input = drafts.get(previous ?? DRAFT_SESSION_ID)
        if (input) importDraft(next, input)
        // The placeholder is consumed once a real session owns its input.
        if (previous === null) importDraft(DRAFT_SESSION_ID, null)
      }
      // Every committed replacement carries the input forward, even when a newer
      // directory request is pending. A later failure must leave a usable session.
      currentId.current = next
      if (!mounted.current) return next
      setId(next)
      callbacks.current.onCreated(next)
      if (active && cwd !== null && cwd !== directory) callbacks.current.onCwdChange(directory)
      if (active && model !== null) setModel(null)
      return next
    })()
    preparation.current = pending
    void pending.then(
      () => {
        if (active) setPreparing(false)
      },
      (failure: unknown) => {
        if (active) {
          setError(failure)
          setPreparing(false)
        }
      }
    )
    // Cleanup does not close the session: remounts and handoffs are not abandonment.
    return () => {
      active = false
    }
  }, [owner, cwd, providerRevision, providerSnapshot?.status, attempt, model])

  const send = async (prompt: acp.ContentBlock[], accept?: (receipt: string) => void): Promise<void> => {
    let target: string | null
    // Follow preparation retries, but never send into a different project or abandoned surface.
    for (;;) {
      const pending = preparation.current
      if (pending === null) throw new Error("The draft session has not started preparing")
      try {
        target = await pending
      } catch (failure) {
        if (mounted.current && pending !== preparation.current) continue
        throw failure
      }
      if (!mounted.current || context.current.owner !== owner || (cwd !== null && context.current.cwd !== cwd))
        throw new Error("The draft changed before the message was sent")
      if (pending !== preparation.current) continue
      if (target === null) throw new Error("The draft session preparation was cancelled")
      break
    }
    onSendingChange(target, true)
    try {
      if (accept === undefined) await client.prompt(target, prompt)
      else accept(await client.prompt(target, prompt))
      if (collectionId !== undefined)
        reportCollection(dispatchCollection({ type: "add", collectionId, sessionId: target }))
    } finally {
      // On failure, keep the input and let native draft ownership decide the view:
      // a request dispatched without a receipt may already have started a turn.
      onSendingChange(target, false)
    }
  }
  const picker = (
    <DraftProjectPicker
      cwd={cwd === null ? null : (session?.cwd ?? cwd)}
      recentProjects={recentProjects}
      onChange={onCwdChange}
      preparing={preparing}
    />
  )
  return (
    <ChatHostProvider>
      <div data-chat-drop-zone className="flex h-full min-h-0 flex-col">
        <ChatHeader target={headerTarget} title={t("sidebar.newChat")} project={projectMenu}>
          <ChatActionsMenu
            surface={headerTarget === undefined ? "main" : "floating"}
            onOpenWindow={session && !preparing ? onOpenWindow : undefined}
            onReturnToMain={preparing ? undefined : onReturnToMain}
            cwd={cwd}
            onNewChat={onNewChat}
            onNewProject={onNewProject}
          />
        </ChatHeader>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle className="text-[28px] font-normal">{t("welcome.title")}</EmptyTitle>
            <EmptyDescription>{t("welcome.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        {!preparing && (error !== null || connection !== "ready") && (
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-6 py-2 text-sm" role="status">
            <span>{error !== null ? text(error) : t("connection.disconnected")}</span>
            <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              {t("actions.retry")}
            </Button>
            {isAuthError(error) && (
              <>
                <Button variant="outline" size="sm" onClick={onAuthRequired}>
                  {t("chat.draft.configureProvider")}
                </Button>
                <DraftModelSelect snapshot={providerSnapshot} model={model} onChange={setModel} />
              </>
            )}
          </div>
        )}
        {id !== null && <SessionActions sessionId={id} />}
        <ChatComposer
          inputHeader={picker}
          session={session ?? pendingComposer}
          allowPendingInput
          preparing={preparing}
          modelSelector={
            session ? (
              <ModelMenu
                {...chatModelMenu}
                sessionId={session.id}
                options={session.configOptions}
                disabled={
                  preparing ||
                  error !== null ||
                  connection !== "ready" ||
                  !session.attached ||
                  session.restoring ||
                  session.readOnly
                }
                onModelChange={(value) => {
                  setPreparing(true)
                  setModel(value)
                }}
              />
            ) : undefined
          }
          disabled={session === null || preparing || error !== null || connection !== "ready"}
          onSubmit={runOperation ? (prompt, accept) => runOperation(() => send(prompt, accept)) : send}
          onHandOff={onVoiceHandoff}
        />
        <FilePreviewModal />
      </div>
    </ChatHostProvider>
  )
}
