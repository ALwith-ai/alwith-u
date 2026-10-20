import type { AttachmentPolicy } from "@alwith/module-chat/composer-context"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { getCurrentWebview } from "@tauri-apps/api/webview"
import { useEffect, useLayoutEffect, useRef } from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { ChatDroppedFile } from "@/bindings"
import { basename } from "@/lib/path"

import { usePromptInputAttachments } from "./prompt-input"

const sourcePaths = new WeakMap<File, string>()
export const nativeAttachmentPolicy: AttachmentPolicy = {
  sourcePath: file => sourcePaths.get(file),
  uniqueFiles(incoming, existing) {
    const paths = new Set(existing.map(file => file.sourcePath))
    return incoming.filter(file => {
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
    const listener = getCurrentWebview().onDragDropEvent(event => {
      if (disposed || event.payload.type !== "drop") return
      const { paths, position } = event.payload
      const target = document.elementFromPoint(
        position.x / window.devicePixelRatio,
        position.y / window.devicePixelRatio
      )
      // Only the conversation owns these drops. The file tree retains its import behavior.
      if (!target?.closest("[data-chat-drop-zone]") || target.closest('[role="dialog"]')) return
      if (!writable()) {
        toast.error(current.current.t("chat.input.dropUnavailable"))
        return
      }
      pending++
      flushSync(() => current.current.onBusyChange(true))
      queue = queue
        .then(async () => {
          try {
            const imagePaths = new Set(current.current.attachments.files.map(file => file.sourcePath))
            for (const path of new Set(paths)) {
              if (!writable()) return
              try {
                const file = await invoke<ChatDroppedFile>("chat_read_dropped_file", { path })
                if (!writable()) return
                if (file.image === null) {
                  flushSync(() => current.current.onMention(file.path))
                } else if (!imagePaths.has(file.path)) {
                  const bytes = Uint8Array.from(atob(file.image.data), char => char.charCodeAt(0))
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
        .catch(error => {
          if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
        })
    })
    void listener
      .then(unlisten => {
        if (disposed) unlisten()
        else stop = unlisten
      })
      .catch(error => {
        if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
      stop?.()
    }
  }, [sessionId])
  return null
}
