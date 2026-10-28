// Ported from ALwith Desktop's codex-search-source.ts: find-in-thread matches come from the
// session data, so turns the virtualized list has not mounted still count. Each match names
// the turn and the occurrence index inside it; the DOM pass then locates the exact range
// after the turn is revealed.
import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import type { Item, Terminal } from "@alwith/api"
import { isText, terminalOf } from "@alwith/api"
import { findTextSourceMatches, type SearchSourceMatch } from "@alwith/module-chat/search-source"
import type { Turn } from "@alwith/module-chat/turns"

function stringsInValue(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(stringsInValue)
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "data" || key === "blob" ? [] : stringsInValue(entry)
  )
}

function blockText(block: acp.ContentBlock): string[] {
  return isText(block) ? [block.text] : []
}

function itemText(item: Item, terminals: Record<string, Terminal>): string[] {
  switch (item.kind) {
    case "user":
    case "assistant":
    case "thought":
      return item.content.flatMap(blockText)
    case "tool":
      return [
        item.title ?? "",
        ...stringsInValue(item.rawInput),
        ...stringsInValue(terminalOf(item, terminals)?.output || item.rawOutput),
        ...stringsInValue(item.content)
      ]
    case "plan":
      return stringsInValue(item.plan)
    case "compaction":
      return [item.error ?? ""]
  }
}

export function findCodexSearchSourceMatches(
  turns: Turn[],
  rawQuery: string,
  terminals: Record<string, Terminal> = {}
): SearchSourceMatch[] {
  const query = rawQuery.trim()
  if (query.length === 0) return []
  return findTextSourceMatches(
    turns.map((turn) => ({ turnKey: turn.key, segments: turn.items.flatMap((item) => itemText(item, terminals)) })),
    query
  )
}
