import { codexMessageError, isContentEntry, isText, type MessageItem, type Session } from "@alwith/module-chat/client"
import { type ImageArtifact, imageArtifacts } from "@alwith/module-chat/image"
import { createChatMarkdown } from "@alwith/module-chat/markdown-rules"
import type { Token } from "marked"

import { imageResultBatches, imageResultReferences } from "./image-results"

const markdown = createChatMarkdown()

type ImageRange = { start: number; end: number; image: ImageArtifact }

/** Resolve only parsed image tokens, leaving code examples and ordinary URLs intact. */
function imageRanges(text: string, images: Map<string, ImageArtifact>, fileImage?: ImageArtifact): ImageRange[] {
  const ranges: ImageRange[] = []
  const visit = (tokens: Token[], source: string, start: number) => {
    let cursor = 0
    for (const token of tokens) {
      const offset = source.indexOf(token.raw, cursor)
      // A multiline block quote may prefix every child line; it has no contiguous child source.
      if (offset < 0) continue
      const position = start + offset
      const href = "href" in token ? String(token.href) : ""
      const image =
        token.type === "image"
          ? images.get(href)
          : token.type === "link" &&
              fileImage &&
              !/^(?:https?:|\/\/)/i.test(href) &&
              /\.(?:png|jpe?g|webp|gif|b64)(?:[?#].*)?$/i.test(href)
            ? fileImage
            : undefined
      if (image) ranges.push({ start: position, end: position + token.raw.length, image })
      else if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens as Token[], token.raw, position)
      else if (token.type === "list" && "items" in token && Array.isArray(token.items))
        visit(token.items as Token[], token.raw, position)
      cursor = offset + token.raw.length
    }
  }
  visit(markdown.lexer(text), text, 0)
  return ranges
}

/** Display native tool images at their reply references; the shared timeline deduplicates the tool results. */
export function imageConversationPresentation(session: Session, focused = false): Session {
  const artifacts = imageArtifacts(session)
  const images = new Map(artifacts.map((image) => [image.id, image]))
  // Code-mode calls can return reference IDs different from the transcript item's ID.
  for (const item of session.items) {
    if (item.kind !== "tool" || item.status !== "completed") continue
    const results = artifacts.filter((image) => image.toolId === item.id)
    if (!results.length) continue
    imageResultReferences(item)?.forEach((reference, index) => {
      if (results[index]) images.set(reference, results[index])
    })
  }
  if (focused) return focusedPresentation(session, images)
  if (!images.size) return session
  let changed = false
  const items = session.items.map((item) => {
    if (item.kind !== "assistant") return item
    let messageChanged = false
    const content = item.content.flatMap((block): typeof item.content => {
      if (!isText(block)) return [block]
      const ranges = imageRanges(block.text, images)
      if (!ranges.length) return [block]
      messageChanged = true
      const result: typeof item.content = []
      let cursor = 0
      for (const range of ranges) {
        const text = block.text.slice(cursor, range.start)
        if (text.trim()) result.push({ ...block, text })
        result.push({ type: "image", mimeType: range.image.mimeType, data: range.image.data })
        cursor = range.end
      }
      const text = block.text.slice(cursor)
      if (text.trim()) result.push({ ...block, text })
      return result
    })
    if (!messageChanged) return item
    changed = true
    return { ...item, content }
  })
  // Never mutate or persist the native transcript when projecting it for the timeline.
  return changed ? { ...session, items } : session
}

/** Image conversations expose results and errors; coding activity remains in the native transcript. */
function focusedPresentation(session: Session, references: Map<string, ImageArtifact>): Session {
  const items: Session["items"] = []
  for (const { turn, tool, images } of imageResultBatches(session)) {
    if (turn.prompt) items.push(turn.prompt)
    const final = turn.entries.findLast((item) => {
      if (item.kind !== "assistant" || codexMessageError(item) !== null) return false
      const codex = item._meta?.codex
      return !codex || typeof codex !== "object" || !("phase" in codex) || codex.phase === "final_answer"
    })
    for (const item of turn.entries) {
      if (item.kind === "assistant" && codexMessageError(item) !== null) items.push(item)
      if (
        !images.length &&
        item.kind === "tool" &&
        (item.name === "image_generation" || item.name === "alwith_client_generate_image")
      )
        items.push(item)
    }
    if (!final && !images.length) {
      const failed = turn.entries.findLast(
        (item) =>
          item.kind === "tool" &&
          item.status === "failed" &&
          (item.name === "image_generation" || item.name === "alwith_client_generate_image")
      )
      if (failed?.kind === "tool") {
        const content = failed.content
          .filter(isContentEntry)
          .map((entry) => entry.content)
          .filter(isText)
        if (content.length)
          items.push({
            id: `${failed.id}:error`,
            kind: "assistant",
            at: failed.at,
            replayed: failed.replayed,
            echo: null,
            content,
            _meta: null
          })
      }
    }
    const anchor = final ?? tool
    if (!anchor) continue
    const content: MessageItem["content"] = images.map((image) => ({
      type: "image",
      mimeType: image.mimeType,
      data: image.data
    }))
    if (final?.kind === "assistant") {
      for (const block of final.content) {
        if (!isText(block)) continue
        const ranges = imageRanges(block.text, references, images[0])
        let text = block.text
        for (const range of ranges.toReversed()) text = text.slice(0, range.start) + text.slice(range.end)
        if (text.trim()) content.push({ ...block, text })
      }
    }
    if (content.length)
      items.push({
        id: anchor.id,
        kind: "assistant",
        at: anchor.at,
        replayed: anchor.replayed,
        echo: null,
        content,
        _meta: {
          ...anchor._meta,
          codex: { ...(anchor._meta?.codex as Record<string, unknown> | undefined), phase: "final_answer" }
        }
      })
  }
  return { ...session, items }
}
