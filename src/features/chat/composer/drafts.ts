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

const writers = new Map<string, (text: string) => void>()

/** A mounted composer remains authoritative for live input and editability. */
export function registerComposerWriter(sessionId: string, write: (text: string) => void): () => void {
  if (writers.has(sessionId)) throw new Error("A composer is already registered for this session")
  writers.set(sessionId, write)
  return () => {
    if (writers.get(sessionId) === write) writers.delete(sessionId)
  }
}

export function setComposerDraft(sessionId: string, text: string): void {
  if (typeof text !== "string" || !text.trim()) throw new Error("草稿内容不能为空")
  const write = writers.get(sessionId)
  if (!write) throw new Error("目标会话的输入框尚未就绪，请先打开该会话")
  const current = drafts.get(sessionId)
  if (current && (current.text.length || current.attachments.length || current.mentions.length))
    throw new Error("输入框已有草稿，请先发送或清空后重试")
  write(text)
  drafts.set(sessionId, { text, attachments: [], mentions: [], modelId: current?.modelId ?? null })
}
