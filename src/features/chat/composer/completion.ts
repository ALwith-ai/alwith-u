import type { FuzzyFileSearchResult } from "@/agent/codex-extensions"
import type { CompletionItem } from "@alwith/module-chat/completion-filter"
export { detectTrigger, type Trigger, type TriggerKind } from "@alwith/module-chat/completion-trigger"
export { filterSlashCommands, type CompletionItem } from "@alwith/module-chat/completion-filter"

/** Absolute path of a Codex search hit (`path` is relative to `root` unless already absolute). */
export function searchResultPath(result: FuzzyFileSearchResult): string {
  if (result.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(result.path)) return result.path
  const root = result.root.replace(/[\\/]+$/, "")
  return `${root}/${result.path}`
}

/** Codex already ranked the hits; the label is the path relative to the search root. */
export function fileItems(results: FuzzyFileSearchResult[], limit = 50): CompletionItem[] {
  return results.slice(0, limit).map(result => {
    const abs = searchResultPath(result)
    return { key: abs, label: result.path, payload: abs, description: result.match_type === "directory" ? "/" : "" }
  })
}
