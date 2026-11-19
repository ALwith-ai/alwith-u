import type {
  AppsInstalledParams,
  FuzzyFileSearchParams,
  FuzzyFileSearchResponse,
  PromptOptions
} from "@alwith/module-chat/client"
import { CodexClient } from "@alwith/module-chat/client"
import type { TerminalClient } from "@alwith/module-terminal"

import { useBrowserQuickChat } from "@/features/browser/quick-chat-state"
import { deleteSessionInputMode } from "@/features/chat/composer/input-mode-config"
import { deleteChatFolder } from "@/features/chat/folder-chat"

import { logBackgroundError } from "./background-errors"
import { initialFileResults } from "./initial-file-results"

/** Main owns native filesystem access; floating clients forward this method to it. */
export class DesktopCodexClient extends CodexClient {
  private readonly terminals: Pick<TerminalClient, "closeSession"> | undefined
  private readonly terminalReads = new Map<string, Set<ReturnType<CodexClient["listBackgroundTerminals"]>>>()
  private readonly deleting = new Map<string, Promise<void>>()
  constructor(
    openPort: ConstructorParameters<typeof CodexClient>[0],
    options: ConstructorParameters<typeof CodexClient>[1],
    terminals?: Pick<TerminalClient, "closeSession">
  ) {
    super(openPort, options)
    this.terminals = terminals
  }
  override async installedApps(params?: AppsInstalledParams): ReturnType<CodexClient["installedApps"]> {
    const response = await super.installedApps(params)
    return {
      ...response,
      apps: response.apps.filter((app) => {
        // These account applications have no corresponding U experience.
        const name = (app.runtimeName ?? app.id).toLowerCase().replaceAll(/[\s/_-]+/g, "")
        return !["pets", "pages", "space", "chatgptspace", "pagesspace"].includes(name)
      })
    }
  }

  protected override promptMeta(id: string, options: PromptOptions): Record<string, unknown> | undefined {
    const { workspaceFolder, ...meta } = options.meta ?? {}
    if (typeof workspaceFolder !== "string") return super.promptMeta(id, options)
    const resolved = super.promptMeta(id, { ...options, meta })
    const alwith = resolved?.alwith as { applicationContext?: Record<string, string | null> } | undefined
    return {
      ...resolved,
      alwith: {
        ...alwith,
        applicationContext: {
          ...alwith?.applicationContext,
          workspaceFolder: `The user started this conversation in ${JSON.stringify(workspaceFolder)}.`
        }
      }
    }
  }

  override async archive(sessionId: string): Promise<void> {
    await this.terminals?.closeSession(sessionId)
    await super.archive(sessionId)
    if (useBrowserQuickChat.getState().sessionId === sessionId)
      useBrowserQuickChat.setState({ sessionId: null, cwd: null })
  }

  override async listBackgroundTerminals(sessionId: string): ReturnType<CodexClient["listBackgroundTerminals"]> {
    // A mounted workspace can outlive its draft while the replacement is prepared.
    if (this.deleting.has(sessionId) || !this.holds(sessionId)) return []
    const session = this.session(sessionId)
    if (!session.attached || session.restoring) return []
    const request = super.listBackgroundTerminals(sessionId)
    const reads = this.terminalReads.get(sessionId) ?? new Set()
    this.terminalReads.set(sessionId, reads)
    reads.add(request)
    try {
      return await request
    } finally {
      reads.delete(request)
      if (reads.size === 0) this.terminalReads.delete(sessionId)
    }
  }

  override delete(sessionId: string): Promise<void> {
    const pending = this.deleting.get(sessionId)
    if (pending) return pending
    const draft = Boolean(this.state.drafts[sessionId])
    // Stop admitting reads before any asynchronous cleanup, and drain admitted reads
    // before removing the remote session. Other sessions remain independent.
    const operation = Promise.resolve()
      .then(async () => {
        await Promise.allSettled(this.terminalReads.get(sessionId) ?? [])
        await this.terminals?.closeSession(sessionId)
        await super.delete(sessionId)
        if (useBrowserQuickChat.getState().sessionId === sessionId)
          useBrowserQuickChat.setState({ sessionId: null, cwd: null })
        if (!draft)
          void deleteChatFolder(sessionId).catch((error) => logBackgroundError("chat-folder-preferences", error))
        await deleteSessionInputMode(sessionId)
      })
      .finally(() => this.deleting.delete(sessionId))
    this.deleting.set(sessionId, operation)
    return operation
  }

  override async fuzzyFileSearch(params: FuzzyFileSearchParams): Promise<FuzzyFileSearchResponse> {
    return {
      files: (await Promise.all(params.roots.map((root) => initialFileResults(root, params.query)))).flat().slice(0, 50)
    }
  }
}
