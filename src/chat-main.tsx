import { tempDir } from "@tauri-apps/api/path"
import { platform } from "@tauri-apps/plugin-os"
import { ChatWindow } from "@/features/chat-window/chat-window"
import { useThreadsUiStore } from "@/features/threads/store"
import { bootstrapAuxWindow } from "@/lib/aux-window-bootstrap"

bootstrapAuxWindow({
  component: ChatWindow,
  logTag: "chat",
  toaster: true,
  setup: async () => {
    if (platform() === "windows") useThreadsUiStore.setState({ windowsTempDirectory: await tempDir() })
  }
})
