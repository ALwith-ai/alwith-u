import { createContext } from "react"

export interface CanvasWorkspace {
  chat: number
  preview: number
  visible: boolean
  maximized: boolean
}
export const CanvasContext = createContext<{
  viewportWidth: number
  budget: number
  selected: number
  trailingActive?: boolean
  split: boolean
  moving: boolean
  setWorkspace: (workspace: CanvasWorkspace) => void
  navigate: (region: "chat" | "preview" | "trailing") => void
  setDividerDragging: (dragging: boolean) => void
} | null>(null)
