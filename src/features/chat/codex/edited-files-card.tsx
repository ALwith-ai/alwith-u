import { EditedFilesCard as SharedCard } from "@alwith/module-chat/edited-files-card"
import { ActivityHostProvider } from "@alwith/module-chat/activity-host"
import { useChatActivityHost } from "./activity-host"
import { CodexFileIcon } from "@/components/icons/codex/file-icon"
import { isDiffEntry } from "@alwith/api"
import type { ToolItem } from "@alwith/api"
import { filePatch, openDiffModal } from "../dialogs/diff-modal"

type FileChange = { path: string; patch: string; additions: number; deletions: number }
type Stats = { additions: number; deletions: number }

/**
 * Per-file +/- counts of a git patch. A patch may touch several files; attributing the
 * whole patch to each of them would count every line once per file.
 */
export function patchStatsByFile(patch: string): Map<string, Stats> {
  const byFile = new Map<string, Stats>()
  let current: Stats | null = null
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null
      continue
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim()
      const path = target === "/dev/null" ? null : target.replace(/^b\//, "")
      if (path !== null) {
        current = { additions: 0, deletions: 0 }
        byFile.set(path, current)
      }
      continue
    }
    if (line.startsWith("--- ")) {
      const source = line.slice(4).trim()
      // A deleted file has no `+++ b/` side; its lines belong to the `--- a/` path.
      if (source !== "/dev/null" && current === null) {
        current = { additions: 0, deletions: 0 }
        byFile.set(source.replace(/^a\//, ""), current)
      }
      continue
    }
    if (current === null) continue
    if (line.startsWith("+")) current.additions += 1
    else if (line.startsWith("-")) current.deletions += 1
  }
  return byFile
}

/** The patch names files relative to the repository; `changes[].path` is absolute. */
function statsFor(byFile: Map<string, Stats>, path: string): Stats {
  const normalized = path.replace(/\\/g, "/")
  for (const [file, stats] of byFile) if (normalized === file || normalized.endsWith(`/${file}`)) return stats
  return { additions: 0, deletions: 0 }
}

function fileChanges(items: ToolItem[]): FileChange[] {
  const byPath = new Map<string, FileChange>()
  for (const item of items) {
    for (const entry of item.content) {
      if (!isDiffEntry(entry)) continue
      const byFile = entry.patch ? patchStatsByFile(entry.patch.text) : new Map<string, Stats>()
      for (const change of entry.changes) {
        const path = typeof change.path === "string" ? change.path : null
        if (path === null) continue
        const stats = statsFor(byFile, path)
        const patch = entry.patch ? filePatch(entry.patch.text, path) : ""
        const current = byPath.get(path)
        if (current) {
          current.additions += stats.additions
          current.deletions += stats.deletions
          // Several edits to one file in a turn: the modal shows them in order.
          current.patch = current.patch ? `${current.patch}\n${patch}` : patch
        } else byPath.set(path, { path, patch, ...stats })
      }
    }
  }
  return [...byPath.values()]
}

export function EditedFilesCard({ items }: { items: ToolItem[] }) {
  const host = useChatActivityHost()
  return (
    <ActivityHostProvider host={host}>
      <SharedCard
        files={fileChanges(items)}
        onOpen={file => openDiffModal({ path: file.path, patch: file.patch })}
        renderPath={file => (
          <>
            <CodexFileIcon path={file.path} className="codex-edited-file-icon" />
            <span className="codex-edited-file-name">{file.path}</span>
          </>
        )}
      />
    </ActivityHostProvider>
  )
}
