import { commands as chatCommands } from "@alwith/module-chat/commands"
import { createContext, useCallback, useContext } from "react"
import { toast } from "sonner"

import { type FilePosition, useWorkspace } from "@/features/workspace/context"
import { fileLocationPath, openExternal, openLocalPath } from "@/lib/open"
import { isMac } from "@/lib/platform"
import { text } from "@/lib/text"

// Scope relative file references to their owning session, including inactive chats.
export const ChatDirectoryContext = createContext<string | null>(null)
/** Opens another session of the current agent in this surface, such as a subagent named in the chat. */
export const ChatOpenSessionContext = createContext<((sessionId: string, title: string) => void) | null>(null)
export const ChatOpenWebLinkContext = createContext<((url: string) => Promise<void>) | null>(null)
export const ChatOpenLocalLinkContext = createContext<
  ((path: string, position?: FilePosition) => Promise<void>) | null
>(null)

export function resolveChatLink(target: string, cwd: string | null): string {
  const relativeLocation = /^[^/\\:]+:\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?$/.test(target)
  if (
    (/^[a-z][a-z\d+.-]*:/i.test(target) && !relativeLocation) ||
    target.startsWith("/") ||
    target.startsWith(String.raw`\\`)
  )
    return target
  if (target.startsWith("www.")) return `https://${target}`
  if (cwd === null) throw new Error("Chat directory is unavailable")
  const directory = encodeURI(cwd.replace(/[\\/]$/, "")).replaceAll(/[?#]/g, encodeURIComponent)
  return `${directory}/${target}`
}

export function useOpenChatLink(): (target: string) => void {
  const cwd = useContext(ChatDirectoryContext)
  const workspace = useWorkspace()
  const openWeb = useContext(ChatOpenWebLinkContext)
  const openLocal = useContext(ChatOpenLocalLinkContext)
  return useCallback(
    (target: string): void => {
      void (async () => {
        const url = resolveChatLink(target, cwd)
        if (
          url.startsWith("/") ||
          /^file:/i.test(url) ||
          /^[A-Za-z]:[\\/]/.test(url) ||
          url.startsWith(String.raw`\\`)
        ) {
          let value = url
          if (/^file:/i.test(url)) {
            const file = new URL(url)
            if (file.pathname.endsWith("/") && !file.hash && !file.search) {
              await openExternal(url)
              return
            }
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
          if (openLocal !== null) await openLocal(target, position)
          else if (workspace === null || (isMac() && /\.app\/?$/i.test(target))) await openLocalPath(target)
          else await (workspace.openChatFile ?? workspace.openFile)(target, cwd, position)
        } else if (openWeb !== null && /^https?:\/\//i.test(url)) await openWeb(url)
        else await openExternal(url)
      })().catch((error: unknown) => toast.error(text(error)))
    },
    [cwd, workspace, openWeb, openLocal]
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
  return chatCommands.saveFile({ name: chatFileName(uri), data })
}
