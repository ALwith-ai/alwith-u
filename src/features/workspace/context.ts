import { createContext, type ReactNode, useContext } from "react"
export interface FilePosition {
  lineNumber: number
  column: number
}

/** What the preview region shows: the file workspace, a device simulator, a terminal, or the project board. */
export type WorkspacePane = "files" | "simulator" | "terminal" | "background" | "board"
export interface WorkspaceActions {
  registerFileReference?: (target: WorkspaceFileReference) => () => void
  visible: boolean
  viewMode?: boolean
  pane?: WorkspacePane
  /** Show the region with this pane; calling it for the visible pane closes the region. */
  openPane?: (pane: WorkspacePane) => void
  toggle: () => void
  /** Open project entries in this workspace; entries outside the owning project use system applications. */
  openFile: (path: string, root: string | null, position?: FilePosition) => Promise<void>
  openChatFile?: (path: string, root: string | null, position?: FilePosition) => Promise<void>
  openProject: (path: string) => Promise<void>
  revealEntry: (path: string, root: string) => Promise<void>
}
/** The mounted composer supplies its explicit session and reference action. */
export interface WorkspaceFileReference {
  sessionId: string
  add: (path: string) => void
}
export const WorkspaceContext = createContext<WorkspaceActions | null>(null)
export function useWorkspace(): WorkspaceActions | null {
  return useContext(WorkspaceContext)
}

export const WorkspaceHeaderContext = createContext<HTMLElement | null>(null)
/** The layout supplies the browser entry below the simulator in the workspace overflow menu. */
export const WorkspaceBrowserEntryContext = createContext<ReactNode>(null)
/** The conversation the preview region belongs to; device panes attach on its behalf. */
export const WorkspaceSessionContext = createContext<string | null>(null)
