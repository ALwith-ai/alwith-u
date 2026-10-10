import type { EditorController, EditorDocument } from "@alwith/module-editor"
import { containsPath, type FileSystem, rebasePath } from "@alwith/module-fs"

export interface WorkspaceMoveOwner {
  root: string
  fs: FileSystem
  editor: EditorController
}
export interface WorkspaceMoveOutcome {
  moves: readonly { from: string; to: string }[]
  cloud: boolean
  error: string | null
}
export interface WorkspaceMoveDependencies {
  owners: readonly WorkspaceMoveOwner[]
  invokeMove: (paths: readonly string[], directory: string) => Promise<WorkspaceMoveOutcome>
  open: (path: string, pinned: boolean, active: boolean) => Promise<void>
}
interface MovingTab {
  owner: WorkspaceMoveOwner
  document: EditorDocument
  active: boolean
  followingPaths: readonly string[]
}

/** Native moves bypass filesystem mutation guards, so finish each tab's save/discard decision first. */
export async function moveWorkspaceFiles(
  paths: readonly string[],
  directory: string,
  dependencies: WorkspaceMoveDependencies
): Promise<boolean> {
  const tabs: MovingTab[] = dependencies.owners.flatMap(owner => {
    const snapshot = owner.editor.getSnapshot()
    return snapshot.documents.flatMap((document, index) =>
      paths.some(path => containsPath(path, document.path))
        ? [
            {
              owner,
              document,
              active: document.id === snapshot.activeId,
              followingPaths: snapshot.documents.slice(index + 1).map(doc => doc.path)
            }
          ]
        : []
    )
  })
  const errors: unknown[] = []
  const closedTabs = new Set<MovingTab>()
  let outcome: WorkspaceMoveOutcome | null = null
  let accepted = true
  try {
    for (const owner of dependencies.owners) {
      const before = owner.editor.getSnapshot().documents
      const closing = tabs.filter(tab => tab.owner === owner && before.some(doc => doc.id === tab.document.id))
      if (closing.length === 0) continue
      try {
        if (!(await owner.editor.requestCloseMany(closing.map(tab => tab.document.id)))) {
          accepted = false
          break
        }
      } finally {
        const after = owner.editor.getSnapshot().documents
        for (const tab of closing) {
          if (!after.some(doc => doc.id === tab.document.id)) closedTabs.add(tab)
        }
      }
    }
    if (accepted) {
      outcome = await dependencies.invokeMove(paths, directory)
      if (outcome.error !== null) errors.push(new Error(outcome.error))
    }
  } catch (error) {
    errors.push(error)
  }

  for (const tab of closedTabs) {
    const { owner, document } = tab
    // A canceled batch or another user action can leave/reopen a live buffer. It remains authoritative.
    if (owner.editor.getSnapshot().documents.some(doc => doc.id === document.id || doc.path === document.path)) continue
    try {
      const move = outcome?.moves
        .filter(mapping => containsPath(mapping.from, document.path))
        .sort((a, b) => b.from.length - a.from.length)[0]
      if (move) {
        if (outcome?.cloud) continue
        await dependencies.open(rebasePath(document.path, move.from, move.to), document.pinned, tab.active)
        continue
      }
      if (outcome?.cloud && outcome.error === null) continue
      // Partial cloud moves can remove sources without creating a local destination.
      if ((await owner.fs.stat(document.path)) === null) continue
      const previousActive = owner.editor.getSnapshot().activeId
      const restored = await owner.editor.open(document.path)
      if (document.pinned) owner.editor.pin(restored.id)
      const current = owner.editor.getSnapshot()
      const following = tab.followingPaths
        .map(path => current.documents.find(doc => doc.path === path))
        .find(doc => doc !== undefined)
      owner.editor.reorder(restored.id, following?.id ?? null)
      if (!tab.active && previousActive !== null && current.documents.some(doc => doc.id === previousActive)) {
        owner.editor.activate(previousActive)
      }
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, "File move or tab restoration failed")
  return accepted
}
