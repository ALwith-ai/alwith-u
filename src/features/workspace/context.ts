import { createContext, useContext } from "react"
export interface FilePosition {
  lineNumber: number
  column: number
}

export interface WorkspaceActions {
  registerFileReference?: (target: WorkspaceFileReference) => () => void
  visible: boolean
  viewMode?: boolean
  toggle: () => void
  openFile: (path: string, root: string | null, position?: FilePosition) => Promise<void>
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
