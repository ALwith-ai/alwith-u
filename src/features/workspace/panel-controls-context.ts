import { createContext } from "react"

// Layout owns both the effective expanded state and the widths cleared by restore.
export interface PanelControls {
  expanded: boolean
  toggleExpanded: () => void
}

export const PanelControlsContext = createContext<PanelControls | null>(null)
