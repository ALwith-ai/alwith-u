import { useStore } from "zustand"

import { ChatWindow } from "@/features/chat-window/chat-window"
import { chatWindowTransparency } from "@/features/chat-window/transparency-preference"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({
  component: ChatWindow,
  logTag: "chat",
  zoomControls: "feedback",
  toaster: true,
  // Transparent is always dark; the opaque appearance follows the user's theme.
  useForcedTheme: () => (useStore(chatWindowTransparency, (state) => state.transparent) ? "dark" : undefined)
})
