import type { ToolItem } from "@nyssance/codex-acp-v2/client"
import { isDiffEntry } from "@nyssance/codex-acp-v2/client"

export interface FilePatch {
  oldPath: string | null
  newPath: string | null
  patch: string
}
export interface PatchResult {
  applied: number[]
  warning?: string | null
  failed: { index: number; message: string } | null
}

/** Keep each ACP diff as an independent batch; repeated edits must retain their order. */
export function filePatches(items: ToolItem[]): FilePatch[] {
  const patches: FilePatch[] = []
  for (const item of items) {
    for (const entry of item.content) {
      if (!isDiffEntry(entry)) continue
      if (item.status !== "completed" || entry.changes.length !== 1 || !entry.patch?.text)
        throw new Error("undo.unsupported")
      const change = entry.changes[0]
      if (!change || typeof change.path !== "string") throw new Error("undo.unsupported")
      const path = change.path
      switch (change.operation) {
        case "add":
          patches.push({
            oldPath: null,
            newPath: path,
            patch: entry.patch.text
          })
          break
        case "delete":
          patches.push({
            oldPath: path,
            newPath: null,
            patch: entry.patch.text
          })
          break
        case "modify":
          patches.push({
            oldPath: path,
            newPath: path,
            patch: entry.patch.text
          })
          break
        case "move":
          if (typeof change.oldPath !== "string") throw new Error("undo.unsupported")
          patches.push({
            oldPath: change.oldPath,
            newPath: path,
            patch: entry.patch.text
          })
          break
        default:
          throw new Error("undo.unsupported")
      }
    }
  }
  if (
    !patches.length ||
    patches.length > 256 ||
    new TextEncoder().encode(patches.map((p) => p.patch).join("")).length > 1_048_576
  )
    throw new Error("undo.unsupported")
  return patches
}

/** A partial result changes only the batches the backend confirmed. */
export function updateUndone(
  previous: readonly boolean[],
  selected: readonly number[],
  result: PatchResult,
  reverse: boolean
): boolean[] {
  const next = [...previous]
  for (const index of result.applied) {
    const original = selected[index]
    if (original === undefined) throw new Error("Invalid patch result index")
    next[original] = reverse
  }
  return next
}
