import type { SavedEditorWorkspace } from "@alwith/module-editor"
import type { FileTreeProps } from "@alwith/module-file-tree"
import { containsPath } from "@alwith/module-fs"

export type IconTheme = NonNullable<FileTreeProps["iconTheme"]>
export interface WorkspaceState {
  tabLayout?: SavedEditorWorkspace
  tabs: { path: string; pinned: boolean }[]
  activePath: string | null
  expanded: string[]
  showHidden: boolean
  showIgnored: boolean
  iconTheme: IconTheme
}
export const iconThemes: readonly IconTheme[] = [
  "vscode-icons",
  "catppuccin-latte",
  "catppuccin-mocha",
  "material-icon-theme"
]

function decodeState(root: string, raw: string): WorkspaceState {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null) throw new Error("Invalid workspace preferences")
  const state = value as Record<string, unknown>
  const validPath = (path: unknown): path is string => typeof path === "string" && containsPath(root, path)
  if (
    !Array.isArray(state.tabs) ||
    !state.tabs.every(
      tab => typeof tab === "object" && tab !== null && validPath(tab.path) && typeof tab.pinned === "boolean"
    ) ||
    !Array.isArray(state.expanded) ||
    !state.expanded.every(validPath) ||
    (state.activePath !== null && !validPath(state.activePath)) ||
    typeof state.showHidden !== "boolean" ||
    typeof state.showIgnored !== "boolean" ||
    !iconThemes.includes(state.iconTheme as IconTheme)
  )
    throw new Error("Invalid workspace preferences")
  if (state.tabLayout !== undefined) {
    const layout = state.tabLayout as Partial<SavedEditorWorkspace> | null
    if (
      !layout ||
      !Array.isArray(layout.tabs) ||
      !layout.tabs.every(
        tab =>
          typeof tab === "object" &&
          tab !== null &&
          (tab.kind === "new" || (tab.kind === "file" && validPath(tab.path)))
      ) ||
      (layout.activeIndex !== null &&
        (typeof layout.activeIndex !== "number" ||
          !Number.isInteger(layout.activeIndex) ||
          layout.activeIndex < 0 ||
          layout.activeIndex >= layout.tabs.length))
    )
      throw new Error("Invalid workspace tab layout")
    const paths = layout.tabs.filter(tab => tab.kind === "file").map(tab => tab.path)
    if (new Set(paths).size !== paths.length) throw new Error("Duplicate workspace tabs")
  }
  return state as unknown as WorkspaceState
}

/** Persist only file UI preferences; document bodies and Codex conversations never enter this store. */
export function createWorkspaceStateStore(storage: Storage = localStorage): {
  load(root: string): Promise<WorkspaceState | null>
  save(root: string, state: WorkspaceState): Promise<void>
} {
  return {
    async load(root) {
      const value = storage.getItem(`workspace:${root}`)
      return value === null ? null : decodeState(root, value)
    },
    async save(root, state) {
      const value = JSON.stringify(state)
      decodeState(root, value)
      storage.setItem(`workspace:${root}`, value)
    }
  }
}
