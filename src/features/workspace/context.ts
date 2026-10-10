import { createContext, useContext } from "react"
export interface WorkspaceActions {
  visible: boolean
  toggle(): void
  openFile(path: string, root: string | null): Promise<void>
  openProject(path: string): Promise<void>
  revealEntry(path: string, root: string): Promise<void>
}
export const WorkspaceContext = createContext<WorkspaceActions | null>(null)
export function useWorkspace(): WorkspaceActions | null {
  return useContext(WorkspaceContext)
}

export const WorkspaceHeaderContext = createContext<HTMLElement | null>(null)
