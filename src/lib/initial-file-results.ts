import type { FuzzyFileSearchResult } from "@alwith/module-chat/client"
import { filterFiles } from "@alwith/module-chat/completion-filter"
import { commands as fsCommands } from "@alwith/module-fs/commands"

interface ProjectFiles {
  root: string
  paths: string[]
}
let snapshot: { cwd: string; pending: Promise<ProjectFiles> } | undefined

/** Match Desktop: reuse the current project's list until the project changes. */
export async function initialFileResults(cwd: string, query = ""): Promise<FuzzyFileSearchResult[]> {
  if (snapshot?.cwd !== cwd) {
    const pending = fsCommands.workspaceListFiles({ path: cwd })
    snapshot = { cwd, pending }
    // Retain the in-flight request as well as its result, including an empty project.
    void pending.catch(() => {
      if (snapshot?.pending === pending) snapshot = undefined
    })
  }
  const { root, paths } = await snapshot.pending
  return filterFiles(paths, query, root).map((item) => ({
    root,
    path: item.label,
    file_name: item.label.slice(item.label.lastIndexOf("/") + 1),
    match_type: "file",
    score: 0,
    indices: null
  }))
}
