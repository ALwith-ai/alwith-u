import { type MarkdownHost, CodexMarkdownRenderer as SharedMarkdown } from "@alwith/module-chat/markdown"
import { createChatMarkdown } from "@alwith/module-chat/markdown-rules"
import type { Token, Tokens } from "marked"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/theme-provider"
import { chatFileName, useOpenChatLink } from "../file-actions"
import { LinkedImage } from "./linked-image"
import { ResourceContent } from "./resource-content"

const markdown = createChatMarkdown()
const artifactExtension = /\.(?:png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|tar|gz|mp[34]|wav|ogg|webm|mov)(?:[?#].*)?$/i
const imageExtension = /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i
type Segment = { key: number; text: string } | { key: number; link: Tokens.Link | Tokens.Image }

function artifactLink(token: Token): token is Tokens.Link | Tokens.Image {
  if (token.type !== "link" && token.type !== "image") return false
  const href = (token as Tokens.Link | Tokens.Image).href
  // Source references and web links continue to use the shared Markdown renderer.
  return !/^www\.|^\/\//i.test(href) && !/^[a-z][a-z\d+.-]*:/i.test(href.replace(/^file:/i, "")) && artifactExtension.test(href)
}

function segments(text: string): Segment[] {
  const tokens = markdown.lexer(text)
  if (!tokens.some(token => token.type === "paragraph" && (token as Tokens.Paragraph).tokens?.some(artifactLink))) return [{ key: 0, text }]
  // Keep reference definitions available in every shared-renderer segment.
  const definitions = Object.entries(tokens.links).map(([id, link]) => `\n[${id}]: <${link.href}>${link.title ? ` ${JSON.stringify(link.title)}` : ""}`).join("")
  const result: Segment[] = []
  let pending = ""
  let offset = 0
  const flush = (): void => {
    if (pending.length > 0) { result.push({ key: offset - pending.length, text: pending + definitions }); pending = "" }
  }
  for (const token of tokens) {
    const inline = token.type === "paragraph" ? (token as Tokens.Paragraph).tokens : undefined
    const standalone = inline?.filter(part => part.type !== "text" || part.raw.trim().length > 0)
    if (standalone?.length && standalone.every(artifactLink)) {
      flush()
      for (const [index, link] of standalone.entries()) result.push({ key: offset + index, link })
    } else pending += token.raw
    offset += token.raw.length
  }
  flush()
  return result
}

export function CodexMarkdownRenderer({ text, streaming }: { text: string; streaming?: boolean }) {
  const openLink = useOpenChatLink()
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const copyLabel = t("actions.copy")
  const host = useMemo<MarkdownHost>(() => ({ theme: resolvedTheme, copyLabel, openLink }), [resolvedTheme, copyLabel, openLink])
  const parts = useMemo(() => segments(text), [text])
  return <>{parts.map(part => "text" in part
    ? <SharedMarkdown key={part.key} text={part.text} streaming={streaming} host={host} />
    : imageExtension.test(part.link.href)
      ? <LinkedImage key={part.key} uri={part.link.href} name={part.link.text || chatFileName(part.link.href)} />
      : <ResourceContent key={part.key} block={{ type: "resource_link", uri: part.link.href, name: part.link.text || chatFileName(part.link.href) }} />)}</>
}
