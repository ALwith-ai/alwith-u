import { createContext } from "react"

import type { FilePosition } from "./context"

export type OpenWorkspaceChatFile = (path: string, position?: FilePosition) => Promise<void>

/**
 * The main window's preview pane. The layout owns the pane on the shell's canvas; the file workspace, which lives
 * inside chat, renders its preview into `slot` and reports how the pane is shown.
 */
export interface PreviewPane {
  slot: HTMLElement | null
  registerDetach?: (handler: () => void) => () => void
  registerOpenChatFile?: (handler: OpenWorkspaceChatFile) => () => void
  show: (state: { hidden: boolean; maximized: boolean }) => void
}
export const PreviewPaneContext = createContext<PreviewPane | null>(null)
