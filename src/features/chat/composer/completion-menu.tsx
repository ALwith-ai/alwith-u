import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { CompletionMenu as SharedCompletionMenu } from "@alwith/module-chat/completion-menu"
import { type RefObject, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { FuzzyFileSearchResult } from "@/agent/codex-extensions"
import { fileItems } from "./completion"
import type { PromptInputTextareaHandle } from "./prompt-input"
const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))
export function CompletionMenu({
  handleRef,
  commands,
  searchFiles,
  onMention,
  forcedOpen = false,
  onForcedOpenChange
}: {
  handleRef: RefObject<PromptInputTextareaHandle | null>
  commands: acp.AvailableCommand[]
  searchFiles?: (query: string) => Promise<FuzzyFileSearchResult[]>
  onMention?: (path: string) => void
  forcedOpen?: boolean
  onForcedOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const findFiles = useCallback(
    async (query: string) => {
      if (!searchFiles) throw new Error("File search is not available")
      return fileItems(await searchFiles(query))
    },
    [searchFiles]
  )
  return (
    <SharedCompletionMenu
      handleRef={handleRef}
      commands={commands}
      searchFiles={searchFiles ? findFiles : undefined}
      onMention={onMention}
      fileSearchDebounceMs={120}
      onSearchError={reportError}
      forcedOpen={forcedOpen}
      onForcedOpenChange={onForcedOpenChange}
      emptyLabel={t("chat.noCommands")}
    />
  )
}
