import type { ForkOptions, FuzzyFileSearchParams, FuzzyFileSearchResponse } from "@alwith/module-chat/client"

import { CodexClient } from "@/agent/client"
import { copySessionInputPreferences, deleteSessionInputMode } from "@/features/chat/composer/input-mode-preferences"

import { initialFileResults } from "./initial-file-results"

/** Main owns native filesystem access; floating clients forward this method to it. */
export class DesktopCodexClient extends CodexClient {
  override async fork(id: string, cwd: string, lastTurnId?: string | ForkOptions): Promise<string> {
    const forked = await super.fork(id, cwd, lastTurnId)
    await copySessionInputPreferences(id, forked)
    return forked
  }

  override async delete(sessionId: string): Promise<void> {
    await super.delete(sessionId)
    await deleteSessionInputMode(sessionId)
  }

  override async fuzzyFileSearch(params: FuzzyFileSearchParams): Promise<FuzzyFileSearchResponse> {
    return {
      files: (await Promise.all(params.roots.map((root) => initialFileResults(root, params.query)))).flat().slice(0, 50)
    }
  }
}
