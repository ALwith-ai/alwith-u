import { containsPath } from "@alwith/module-fs"
import { invoke } from "@tauri-apps/api/core"
import { createContext, useCallback, useContext } from "react"
import { toast } from "sonner"
import { useWorkspace } from "@/features/workspace/context"
import { fileLocationPath, openExternal } from "@/lib/open"
import { openFilePreview } from "./dialogs/file-preview-modal"

// Scope relative file references to their owning thread, including inactive chats.
export const ChatDirectoryContext = createContext<string | null>(null)

export function resolveChatLink(target: string, cwd: string | null): string {
  const relativeLocation = /^[^/\\:]+:\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?$/.test(target)
  if ((/^[a-z][a-z\d+.-]*:/i.test(target) && !relativeLocation) || target.startsWith("/") || target.startsWith("\\\\"))
    return target
  if (target.startsWith("www.")) return `https://${target}`
  if (cwd === null) throw new Error("Chat directory is unavailable")
  const directory = encodeURI(cwd.replace(/[\\/]$/, "")).replace(/[?#]/g, encodeURIComponent)
  return `${directory}/${target}`
}

export function useOpenChatLink(): (target: string) => void {
  const cwd = useContext(ChatDirectoryContext)
  const workspace = useWorkspace()
  return useCallback(
    (target: string): void => {
      void (async () => {
        const url = resolveChatLink(target, cwd)
        if (url.startsWith("/") || url.startsWith("file:") || /^[A-Za-z]:[\\/]/.test(url) || url.startsWith("\\\\")) {
          let value = url
          if (url.startsWith("file:")) {
            const file = new URL(url)
            value = file.pathname + file.hash
            if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1)
            if (file.hostname && file.hostname !== "localhost") value = `//${file.hostname}${value}`
          }
          const location = /(?::(\d+)(?::(\d+))?(?:[-–]\d+(?::\d+)?)?|#L(\d+)(?:C(\d+))?(?:-L\d+(?:C\d+)?)?)$/.exec(
            value
          )
          const position =
            location === null
              ? undefined
              : {
                  lineNumber: Math.max(1, Number(location[1] ?? location[3])),
                  column: Math.max(1, Number(location[2] ?? location[4] ?? 1))
                }
          const target = fileLocationPath(value)
          if (workspace !== null && cwd !== null && containsPath(cwd, target))
            await workspace.openFile(target, cwd, position)
          else openFilePreview(target, position)
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
