import { type AttachmentPolicy, usePromptInputAttachments } from "@alwith/module-chat/composer-context"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { useEffect, useLayoutEffect, useRef } from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { basename } from "@/lib/path"

const sourcePaths = new WeakMap<File, string>()
export const nativeAttachmentPolicy: AttachmentPolicy = {
  sourcePath: (file) => sourcePaths.get(file),
  uniqueFiles(incoming, existing) {
    const paths = new Set(existing.map((file) => file.sourcePath))
    return incoming.filter((file) => {
      const path = sourcePaths.get(file)
      if (path === undefined) return true
      if (paths.has(path)) return false
      paths.add(path)
      return true
    })
  }
}

/** Adapt native OS drops to the shared composer; never subscribe on attachment updates. */
export function NativeFileDrop({
  sessionId,
  enabled,
  onMention,
  onBusyChange
}: {
  sessionId: string
  enabled: boolean
  onMention: (path: string) => void
  onBusyChange: (busy: boolean) => void
}) {
  const attachments = usePromptInputAttachments()
  const { t } = useTranslation()
  const current = useRef({ sessionId, attachments, enabled, onMention, onBusyChange, t })
  useLayoutEffect(() => {
    current.current = { sessionId, attachments, enabled, onMention, onBusyChange, t }
  })
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let stop: (() => void) | undefined
    let queue = Promise.resolve()
    let pending = 0
    const writable = () => !disposed && current.current.sessionId === sessionId && current.current.enabled
    current.current.onBusyChange(false)
    const enqueue = (read: () => Promise<Array<string | File>>) => {
      pending++
      flushSync(() => current.current.onBusyChange(true))
      queue = queue
        .then(async () => {
          try {
            const imagePaths = new Set(current.current.attachments.files.map((file) => file.sourcePath))
            for (const source of new Set(await read())) {
              const path = typeof source === "string" ? source : source.name
              if (!writable()) return
              try {
                if (typeof source !== "string" && source.type.startsWith("image/")) {
                  flushSync(() => current.current.attachments.add([source]))
                  continue
                }
                if (typeof source !== "string" && source.size > 32 * 1024 * 1024)
                  throw new Error("Pasted file exceeds the 32 MiB limit")
                const sourcePath =
                  typeof source === "string"
                    ? source
                    : await commands.chatWritePastedFile({
                        name: source.name,
                        data: Array.from(new Uint8Array(await source.arrayBuffer()))
                      })
                if (!writable()) return
                const file = await commands.chatReadDroppedFile({ path: sourcePath })
                if (!writable()) return
                if (file.image === null) {
                  flushSync(() => current.current.onMention(file.path))
                } else if (!imagePaths.has(file.path)) {
                  const bytes = Uint8Array.from(atob(file.image.data), (char) => char.charCodeAt(0))
                  const image = new File([bytes], file.name, { type: file.image.mimeType })
                  sourcePaths.set(image, file.path)
                  imagePaths.add(file.path)
                  // Apply the shared budget after each file instead of buffering an unbounded batch.
                  flushSync(() => current.current.attachments.add([image]))
                }
              } catch (error) {
                if (!disposed)
                  toast.error(current.current.t("chat.input.dropFailed", { name: basename(path) }), {
                    description: error instanceof Error ? error.message : String(error)
                  })
              }
            }
          } finally {
            pending--
            if (!disposed) flushSync(() => current.current.onBusyChange(pending > 0))
          }
        })
        .catch((error) => {
          if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
        })
    }
    const listener = getCurrentWebview().onDragDropEvent((event) => {
      if (disposed || event.payload.type !== "drop") return
      const { paths, position } = event.payload
      const target = document.elementFromPoint(
        position.x / window.devicePixelRatio,
        position.y / window.devicePixelRatio
      )
      if (!target?.closest("[data-chat-drop-zone]") || target.closest('[role="dialog"]')) return
      if (!writable()) {
        toast.error(current.current.t("chat.input.dropUnavailable"))
        return
      }
      enqueue(() => Promise.resolve(paths))
    })
    const paste = (event: ClipboardEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.matches("[data-chat-input]")) return
      if (!target.closest("[data-chat-drop-zone]") || target.closest('[role="dialog"]')) return
      const clipboard = event.clipboardData
      if (!clipboard) return
      const files = Array.from(clipboard.files ?? [])
      const items = Array.from(clipboard.items ?? [])
      // Image-only clipboard data already belongs to the shared textarea's image handler.
      const nativeFiles =
        clipboard.types.includes("Files") && !files.length && !items.some((item) => item.type.startsWith("image/"))
      if (
        !nativeFiles &&
        !files.some((file) => !file.type.startsWith("image/")) &&
        !items.some((item) => item.kind === "file" && !item.type.startsWith("image/")) &&
        !["text/uri-list", "x-special/gnome-copied-files"].some(
          (type) => clipboard.types.includes(type) && /^file:\/\//m.test(clipboard.getData(type))
        )
      )
        return
      event.preventDefault()
      event.stopPropagation()
      if (!writable()) {
        toast.error(current.current.t("chat.input.dropUnavailable"))
        return
      }
      // Start the native read at the paste event, rather than after an earlier drop finishes.
      const paths = commands.chatClipboardFilePaths().then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      enqueue(async () => {
        const result = await paths
        if ("error" in result) throw result.error
        const native = result.value
        if (native.length) return native
        if (files.length) return files
        throw new Error("The clipboard contains no readable local files")
      })
    }
    document.addEventListener("paste", paste, true)
    void listener
      .then((unlisten) => {
        if (disposed) unlisten()
        else stop = unlisten
      })
      .catch((error) => {
        if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
      document.removeEventListener("paste", paste, true)
      stop?.()
    }
  }, [sessionId])
  return null
}
