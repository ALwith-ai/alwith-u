import { createContext } from "react"

/**
 * The main window's preview pane. The layout owns the pane on the shell's canvas; the file workspace, which lives
 * inside chat, renders its preview into `slot` and reports how the pane is shown.
 */
export interface PreviewPane {
  slot: HTMLElement | null
  show: (state: { hidden: boolean; maximized: boolean }) => void
}
export const PreviewPaneContext = createContext<PreviewPane | null>(null)
