// A draft owns a real ACP session before the first send, as in Desktop.
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { invoke } from "@tauri-apps/api/core"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { DraftOwner } from "@/agent/client"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { client, useApp, useSession } from "@/lib/client"
import type { ProviderSnapshot } from "@/lib/providers"
import { applyProviders } from "@/lib/providers"
import { ChatActionsMenu } from "./chat-actions-menu"
import { ChatHeader } from "./chat-header"
import { Composer } from "./composer"
import { DraftModelSelect } from "./composer/draft-model-select"
import { drafts, importDraft } from "./composer/drafts"
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
  onSendingChange,
  onAuthRequired,
  providerSnapshot,
  onOpenWindow,
  runOperation,
  headerTarget,
  projectMenu,
  onNewChat,
  onNewProject
}: {
  owner: DraftOwner
  cwd: string | null
  onCwdChange: (cwd: string) => void
  /** Bind the precreated session to this surface without materializing a history entry. */
  onCreated: (sessionId: string) => void
  /** Hold this composer only while its own first send is waiting for acceptance. */
  onSendingChange: (sessionId: string, sending: boolean) => void
  onAuthRequired: () => void
  providerSnapshot: ProviderSnapshot | null
  runOperation?: (operation: () => Promise<void>) => Promise<void>
  onOpenWindow?: () => void
  headerTarget?: HTMLElement | null
  projectMenu?: ReactNode
  onNewChat: () => void
  onNewProject?: () => void
}) {
  const { t } = useTranslation()
  const threads = useApp(state => state.threads)
  const connection = useApp(state => state.connection)
  const [id, setId] = useState<string | null>(
    () => Object.keys(client.state.draftSessions).find(key => client.state.draftSessions[key] === owner) ?? null
  )
  const session = useSession(id)
  const [preparing, setPreparing] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const [model, setModel] = useState<string | null>(null)
  const callbacks = useRef({ onCwdChange, onCreated })
  callbacks.current = { onCwdChange, onCreated }
  const currentId = useRef(id)
  currentId.current = id
  const mounted = useRef(false)
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
        [...threads].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")).map(thread => thread.cwd)
      )
    ],
    [threads]
  )

  useEffect(() => {
    // Explicit retries invalidate a completed or failed preparation.
    void attempt
    if (providerRevision === undefined) return
    let active = true
    setPreparing(true)
    setError(null)
    void (async () => {
      const directory = await invoke<string>("draft_directory", { cwd })
      await client.connect()
      await applyProviders()
      if (!active) return
      const next = await client.prepareDraft(owner, directory, model)
      const previous = currentId.current
      if (previous !== next) {
        const input = drafts.get(previous ?? DRAFT_SESSION_ID)
        if (input) importDraft(next, input)
      }
      // Every committed replacement carries the input forward, even when a newer
      // directory request is pending. A later failure must leave a usable session.
      currentId.current = next
      if (!mounted.current) return
      setId(next)
      callbacks.current.onCreated(next)
      if (active && cwd !== directory) callbacks.current.onCwdChange(directory)
      if (active && model !== null) setModel(null)
    })()
      .catch((failure: unknown) => {
        if (active) setError(failure)
      })
      .finally(() => {
        if (active) setPreparing(false)
      })
    // Cleanup does not close the session: remounts and handoffs are not abandonment.
    return () => {
      active = false
    }
  }, [owner, cwd, providerRevision, attempt, model])

  const send = async (prompt: acp.ContentBlock[]): Promise<void> => {
    if (id === null || preparing) throw new Error("The draft session is not ready")
    onSendingChange(id, true)
    try {
      await client.prompt(id, prompt)
      // Clear persisted input before the parent mounts the conversation's composer.
      importDraft(id, null)
    } finally {
      // On failure, keep the input and let native draft ownership decide the view:
      // a request dispatched without a receipt may already have started a turn.
      onSendingChange(id, false)
    }
  }
  const picker = <DraftProjectPicker cwd={session?.cwd ?? cwd} recentProjects={recentProjects} onChange={onCwdChange} />
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader target={headerTarget} title={t("sidebar.newChat")} project={projectMenu}>
        <ChatActionsMenu
          surface={headerTarget === undefined ? "main" : "floating"}
          onOpenWindow={session && !preparing ? onOpenWindow : undefined}
          cwd={session?.cwd ?? cwd}
          onNewChat={onNewChat}
          onNewProject={onNewProject}
        />
      </ChatHeader>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>{t("welcome.title")}</EmptyTitle>
          <EmptyDescription>{t("welcome.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
      {(preparing || error !== null || connection !== "ready") && (
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-6 py-2 text-sm" role="status">
          <span>
            {preparing
              ? t("chat.draft.preparing")
              : error !== null
                ? error instanceof Error
                  ? error.message
                  : String(error)
                : t("connection.disconnected")}
          </span>
          {!preparing && (
            <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>
              {t("actions.retry")}
            </Button>
          )}
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
      {session ? (
        <Composer
          key={session.id}
          inputHeader={picker}
          session={session}
          disabled={preparing || error !== null || connection !== "ready"}
          onSubmit={runOperation ? prompt => runOperation(() => send(prompt)) : send}
        />
      ) : (
        <div className="mx-auto w-full max-w-3xl px-6 pb-5">{picker}</div>
      )}
    </div>
  )
}
