import type { AppsInstalledParams, FuzzyFileSearchParams, FuzzyFileSearchResponse } from "@alwith/module-chat/client"

import { CodexClient } from "@/agent/client"
import { deleteSessionInputMode } from "@/features/chat/composer/input-mode-config"

import { initialFileResults } from "./initial-file-results"

/** Main owns native filesystem access; floating clients forward this method to it. */
export class DesktopCodexClient extends CodexClient {
  override async installedApps(params?: AppsInstalledParams): ReturnType<CodexClient["installedApps"]> {
    const response = await super.installedApps(params)
    return {
      ...response,
      apps: response.apps.filter((app) => {
        // These account applications have no corresponding U experience.
        const name = (app.runtimeName ?? app.id).toLowerCase().replace(/[\s/_-]+/g, "")
        return !["pets", "pages", "space", "chatgptspace", "pagesspace"].includes(name)
      })
    }
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
