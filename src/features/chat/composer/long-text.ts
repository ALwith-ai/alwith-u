import type { ClipboardEvent } from "react"

import { commands } from "@/bindings"

import { drafts, trackDraftAttachmentWrite, updateDraftAttachments } from "./drafts"
import type { Attachment, FileUIPart } from "./prompt-input-context"

export type PastedTextAttachment = Attachment & {
  pastedText: { text: string; status: "pending" | "ready" | "error" }
}

export function isPastedTextAttachment(file: FileUIPart): file is PastedTextAttachment {
  return "pastedText" in file
}

export function writePastedTextAttachment(sessionId: string, attachment: PastedTextAttachment): void {
  const replace = (status: PastedTextAttachment["pastedText"]["status"], path?: string) => {
    // A prepared session or transferred draft may now own the same attachment.
    for (const [owner, draft] of drafts) {
      if (!draft.attachments.some((file) => file.id === attachment.id)) continue
      updateDraftAttachments(owner, (files) =>
        files.map((file) =>
          file.id === attachment.id
            ? {
                ...attachment,
                url:
                  path === undefined ? "" : `file://${encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F")}`,
                pastedText: { text: attachment.pastedText.text, status }
              }
            : file
        )
      )
    }
  }
  if (!drafts.get(sessionId)?.attachments.some((file) => file.id === attachment.id)) return
  replace("pending")
  trackDraftAttachmentWrite(
    attachment.id,
    commands
      .chatWriteTextAttachment({ name: "pasted-text.txt", text: attachment.pastedText.text })
      .then((path) => replace("ready", path))
      .catch(() => replace("error"))
  )
}

export function pasteLongText(event: ClipboardEvent<HTMLTextAreaElement>, sessionId: string, filename: string): void {
  if (event.defaultPrevented || event.currentTarget.disabled) return
  // Image pastes retain the shared composer's precedence over accompanying clipboard text.
  if ([...event.clipboardData.items].some((item) => item.kind === "file" && item.type.startsWith("image/"))) return
  const text = event.clipboardData.getData("text/plain")
  if (text.length < 5000) return
  event.preventDefault()
  event.stopPropagation()
  const attachment: PastedTextAttachment = {
    id: crypto.randomUUID(),
    type: "file",
    mediaType: "text/plain",
    filename,
    url: "",
    pastedText: { text, status: "pending" }
  }
  updateDraftAttachments(sessionId, (files) => [...files, attachment])
  writePastedTextAttachment(sessionId, attachment)
}
