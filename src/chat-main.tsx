import { ChatWindow } from "@/features/chat-window/chat-window"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({ component: ChatWindow, logTag: "chat", toaster: true })
