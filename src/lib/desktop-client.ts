import type { SessionUpdate } from "@agentclientprotocol/sdk/experimental/v2/unstable"
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
import { projectTurnRetry } from "./turn-retry"

/** Main owns native filesystem access; floating clients forward this method to it. */
export class DesktopCodexClient extends CodexClient {
  private readonly terminals: Pick<TerminalClient, "closeSession"> | undefined
  private readonly deleting = new Map<string, Promise<void>>()
  constructor(
    openPort: ConstructorParameters<typeof CodexClient>[0],
    options: ConstructorParameters<typeof CodexClient>[1],
    terminals?: Pick<TerminalClient, "closeSession">
  ) {
    super(openPort, options)
    this.terminals = terminals
  }
  protected override onUpdate(sessionId: string, update: SessionUpdate): void {
    const previous = this.sessions.sessions.get(sessionId)
    super.onUpdate(sessionId, update)
    const session = this.sessions.sessions.get(sessionId)
    if (!previous || !session || session === previous) return
    const projected = projectTurnRetry(previous, session, update)
    if (projected !== session) this.publishSession(projected)
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

  override delete(sessionId: string): Promise<void> {
    const pending = this.deleting.get(sessionId)
    if (pending) return pending
    const draft = Boolean(this.state.drafts[sessionId])
    const operation = Promise.resolve()
      .then(async () => {
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
