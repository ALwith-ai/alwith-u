import { filterFiles } from "@alwith/module-chat/completion-filter"
import type { FuzzyFileSearchResult } from "@nyssance/codex-acp-v2/client"
import { invoke } from "@tauri-apps/api/core"

interface ProjectFiles {
  root: string
  paths: string[]
}
let snapshot: { cwd: string; pending: Promise<ProjectFiles> } | undefined

/** Match Desktop: reuse the current project's list until the project changes. */
export async function initialFileResults(cwd: string, query = ""): Promise<FuzzyFileSearchResult[]> {
  if (snapshot?.cwd !== cwd) {
    const pending = invoke<ProjectFiles>("workspace_list_files", { path: cwd })
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
