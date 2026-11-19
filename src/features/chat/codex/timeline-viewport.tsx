import { drafts, updateDraftAttachments } from "@alwith/module-chat/conversation"
import type { TimelineViewportProps } from "@alwith/module-chat/session-timeline"
import { ImagePlusIcon } from "lucide-react"
import { useRef } from "react"
import { useTranslation } from "react-i18next"

import { Pane } from "@/components/alwith-ui/pane"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"

const imagePreviews = [
  ".codex-generated-image-preview",
  ".codex-assistant-message [data-markdown-image-preview-trigger]",
  ".codex-assistant-message .codex-markdown-artifacts button:has(> img)"
].join(", ")

type ImageSelection = { trigger: HTMLElement; url: string; mediaType: string }

export function TimelineViewport({
  sessionId,
  viewportRef,
  viewportProps,
  children
}: TimelineViewportProps & { sessionId?: string }) {
  const { t } = useTranslation()
  const selected = useRef<ImageSelection | null>(null)
  const pane = {
    nativeScroll: true,
    viewportRef,
    viewportClassName: "overflow-x-hidden overscroll-none",
    viewportProps
  }
  if (!sessionId) return <Pane {...pane}>{children}</Pane>

  const selectImage = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element) || !drafts.has(sessionId)) return false
    const trigger = target.closest<HTMLElement>(imagePreviews)
    const image = trigger?.querySelector("img")
    if (!trigger || !image) return false
    const url = image.currentSrc || image.src
    const mediaType = /^data:(image\/[\w.+-]+);base64,/i.exec(url)?.[1]
    if (!mediaType) return false
    selected.current = { trigger, url, mediaType }
    return true
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={({ onContextMenu, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, ...trigger }) => (
          <>
            <Pane
              {...pane}
              onContextMenu={(event) => {
                if (!event.defaultPrevented && selectImage(event.target)) onContextMenu?.(event)
              }}
              onTouchStart={(event) => {
                if (!event.defaultPrevented && selectImage(event.target)) onTouchStart?.(event)
              }}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchCancel}
            >
              {children}
            </Pane>
            {/* Delegate the trigger's gestures only for images in the shared timeline. */}
            <div {...trigger} hidden />
          </>
        )}
      />
      <ContextMenuContent finalFocus={() => selected.current?.trigger}>
        <ContextMenuItem
          onClick={() => {
            if (!selected.current) return
            const { mediaType, url } = selected.current
            updateDraftAttachments(sessionId, (attachments) => [
              ...attachments,
              { id: crypto.randomUUID(), type: "file", mediaType, filename: `image.${mediaType.slice(6)}`, url }
            ])
          }}
        >
          <ImagePlusIcon />
          {t("chat.image.addToChat")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
