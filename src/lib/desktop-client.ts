import { CodexClient } from "@/agent/client"
import type { FuzzyFileSearchParams, FuzzyFileSearchResponse } from "@/agent/codex-extensions"

import { initialFileResults } from "./initial-file-results"

/** Main owns native filesystem access; floating clients forward this method to it. */
export class DesktopCodexClient extends CodexClient {
  override async fuzzyFileSearch(params: FuzzyFileSearchParams): Promise<FuzzyFileSearchResponse> {
    return {
      files: (await Promise.all(params.roots.map(root => initialFileResults(root, params.query)))).flat().slice(0, 50)
    }
  }
}
