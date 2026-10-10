import { useWorkspace } from "@/features/workspace/context"
import { invoke } from "@tauri-apps/api/core"
import { createContext, useCallback, useContext } from "react"
import { toast } from "sonner"
import { openExternal } from "@/lib/open"

// Scope relative file references to their owning thread, including inactive chats.
export const ChatDirectoryContext = createContext<string | null>(null)

export function useOpenChatLink(): (target: string) => void {
  const cwd = useContext(ChatDirectoryContext)
  const workspace = useWorkspace()
  return useCallback(
    (target: string): void => {
      void (async () => {
        let url = target
        const relativeLocation = /^[^/\\:]+:\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?$/.test(url)
        if ((!/^[a-z][a-z\d+.-]*:/i.test(url) || relativeLocation) && !url.startsWith("/") && !url.startsWith("\\\\")) {
          if (url.startsWith("www.")) url = `https://${url}`
          else {
            if (cwd === null) throw new Error("Chat directory is unavailable")
            const directory = encodeURI(cwd.replace(/[\\/]$/, "")).replace(/[?#]/g, encodeURIComponent)
            url = `${directory}/${url}`
          }
        }
        if (workspace !== null && (url.startsWith("/") || url.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(url))) {
          const path = url.startsWith("file:") ? decodeURIComponent(new URL(url).pathname) : decodeURIComponent(url)
          await workspace.openFile(path.replace(/:\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?$/, ""), cwd)
        } else await openExternal(url)
      })().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
    },
    [cwd, workspace]
  )
}

export function chatFileName(uri: string): string {
  let name = uri.split(/[\\/]/).at(-1) ?? uri
  if (uri.startsWith("file:") || /^https?:/.test(uri)) name = new URL(uri).pathname.split("/").at(-1) ?? ""
  try {
    return decodeURIComponent(name) || "attachment"
  } catch (error: unknown) {
    if (error instanceof URIError) return name || "attachment"
    throw error
  }
}

export function downloadChatFile(uri: string, data: string): Promise<boolean> {
  return invoke<boolean>("chat_save_file", { name: chatFileName(uri), data })
}
