import type { Attachment } from "./prompt-input-context"

export type ComposerDraft = { text: string; attachments: Attachment[]; mentions: string[]; modelId: string | null }
export const drafts = new Map<string, ComposerDraft>()

/** Blob URLs belong to a webview; materialize images before handing a draft to another window. */
export async function exportDraft(sessionId: string): Promise<ComposerDraft | null> {
  const draft = drafts.get(sessionId)
  if (!draft) return null
  const attachments = await Promise.all(
    draft.attachments.map(async attachment => {
      if (!attachment.url.startsWith("blob:")) return attachment
      const response = await fetch(attachment.url)
      if (!response.ok) throw new Error("Cannot read draft image")
      const blob = await response.blob()
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      })
      return { ...attachment, url }
    })
  )
  return { text: draft.text, mentions: [...draft.mentions], attachments, modelId: draft.modelId }
}

export function importDraft(sessionId: string, draft: ComposerDraft | null): void {
  if (draft === null) drafts.delete(sessionId)
  else drafts.set(sessionId, draft)
}
