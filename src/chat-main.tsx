import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"
import { ChatWindow } from "@/features/chat-window/chat-window"

bootstrapAuxWindow({ component: ChatWindow, logTag: "chat", toaster: true })
