// The empty draft, ALwith Desktop's lazy-spawn default view: the chat surface with the
// composer ready and a project capsule; the Codex session exists only once the first
// message is sent (Desktop's ensureSession).
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { createSession } from "@alwith/api"
import { client, useApp } from "@/lib/client"
import { Composer } from "./composer"
import { chooseFolder, DraftProjectPicker } from "./draft-project-picker"
import { DraftModelSelect } from "./composer/draft-model-select"
import type { ProviderKey } from "@/lib/providers"
import { applyProviders, PROVIDERS, gatewayModelId } from "@/lib/providers"

export const DRAFT_SESSION_ID = "draft"

/** Codex answers session/new with -32000 when nobody is signed in. */
function isAuthError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === -32000
}

export function DraftChat({
  cwd,
  onCwdChange,
  onCreated,
  onAuthRequired,
  providerKeys
}: {
  cwd: string | null
  onCwdChange: (cwd: string) => void
  /** The first send created the session; the app selects it. */
  onCreated: (sessionId: string) => void
  /** session/new refused for want of a login; the app opens provider settings. */
  onAuthRequired: () => void
  providerKeys: Record<string, ProviderKey>
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
  const [model, setModel] = useState<string | null>(null)

  const send = async (prompt: acp.ContentBlock[]) => {
    await client.connect()
    if (
      model !== null &&
      !PROVIDERS.some(
        provider =>
          providerKeys[provider.id] !== undefined &&
          provider.models.some(item => gatewayModelId(provider.id, item.id) === model)
      )
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
      if (!isAuthError(error)) throw error
      onAuthRequired()
      throw error
    }
    onCreated(id)
    await client.prompt(id, prompt)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="relative flex h-12 shrink-0 items-center gap-3 px-4" data-tauri-drag-region>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="truncate text-sm font-medium" data-tauri-drag-region>
            {t("sidebar.newChat")}
          </div>
          <DraftProjectPicker cwd={cwd} recentProjects={recentProjects} onChange={onCwdChange} />
        </div>
      </header>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>{t("welcome.title")}</EmptyTitle>
          <EmptyDescription>{t("welcome.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <Composer
        session={{ ...draft, cwd: cwd ?? "" }}
        onSubmit={send}
        modelSelector={<DraftModelSelect keys={providerKeys} model={model} onChange={setModel} />}
      />
    </div>
  )
}
