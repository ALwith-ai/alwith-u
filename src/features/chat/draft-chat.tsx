// The empty draft, ALwith Desktop's lazy-spawn default view: the chat surface with the
// composer ready and a project capsule; the Codex session exists only once the first
// message is sent (Desktop's ensureSession).
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { createSession } from "@alwith/api"
import { type ReactNode, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { client, useApp } from "@/lib/client"
import type { ProviderSnapshot } from "@/lib/providers"
import { applyProviders, gatewayModelId, providerGroups } from "@/lib/providers"
import { ChatActionsMenu } from "./chat-actions-menu"
import { ChatHeader } from "./chat-header"
import { Composer } from "./composer"
import { DraftModelSelect } from "./composer/draft-model-select"
import { drafts } from "./composer/drafts"
import { chooseFolder, DraftProjectPicker } from "./draft-project-picker"

export const DRAFT_SESSION_ID = "draft"

/** Codex answers session/new with -32000 when nobody is signed in. */
export function isAuthRequiredError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === -32000
}

export function DraftChat({
  cwd,
  onCwdChange,
  onCreated,
  onAuthRequired,
  providerSnapshot,
  onOpenWindow,
  runOperation,
  headerTarget,
  projectMenu,
  onNewChat,
  onNewProject
}: {
  cwd: string | null
  onCwdChange: (cwd: string) => void
  /** The first send created the session; the app selects it. */
  onCreated: (sessionId: string) => void
  /** session/new refused for want of a login; the app opens provider settings. */
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
  const recentProjects = useMemo(() => {
    const seen = new Set<string>()
    const ordered = [...threads].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    for (const thread of ordered) seen.add(thread.cwd)
    return [...seen]
  }, [threads])
  // A session-shaped draft keeps the composer usable; nothing about it reaches Codex.
  const [draft] = useState(() => ({ ...createSession(DRAFT_SESSION_ID, ""), attached: true }))
  const [model, setModel] = useState<string | null>(() => drafts.get(DRAFT_SESSION_ID)?.modelId ?? null)
  const chooseModel = (modelId: string | null): void => {
    setModel(modelId)
    const draft = drafts.get(DRAFT_SESSION_ID)
    drafts.set(DRAFT_SESSION_ID, {
      text: draft?.text ?? "",
      attachments: draft?.attachments ?? [],
      mentions: draft?.mentions ?? [],
      modelId
    })
  }

  const send = async (prompt: acp.ContentBlock[]) => {
    await client.connect()
    if (
      model !== null &&
      (providerSnapshot === null ||
        !providerGroups(providerSnapshot).some(provider =>
          provider.models.some(item => gatewayModelId(provider.id, item.id) === model)
        ))
    ) {
      onAuthRequired()
      throw new Error(t("provider.modelUnavailable"))
    }
    if (model !== null && !client.providerCatalog) throw new Error(t("provider.catalogUnavailable"))
    await applyProviders()
    let directory = cwd
    if (directory === null) {
      directory = await chooseFolder(null)
      if (directory === null) return
      onCwdChange(directory)
    }
    let id: string
    try {
      id = await client.newSession(directory, model)
    } catch (error) {
      if (!isAuthRequiredError(error)) throw error
      onAuthRequired()
      throw error
    }
    onCreated(id)
    await client.prompt(id, prompt)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader target={headerTarget} title={t("sidebar.newChat")} project={projectMenu}>
        <ChatActionsMenu
          surface={headerTarget === undefined ? "main" : "floating"}
          onOpenWindow={onOpenWindow}
          cwd={cwd}
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
      <Composer
        inputHeader={<DraftProjectPicker cwd={cwd} recentProjects={recentProjects} onChange={onCwdChange} />}
        session={{ ...draft, cwd: cwd ?? "" }}
        onSubmit={runOperation ? prompt => runOperation(() => send(prompt)) : send}
        modelSelector={<DraftModelSelect snapshot={providerSnapshot} model={model} onChange={chooseModel} />}
      />
    </div>
  )
}
