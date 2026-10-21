import { type MarkdownHost, CodexMarkdownRenderer as SharedMarkdown } from "@alwith/module-chat/markdown"
import { createChatMarkdown } from "@alwith/module-chat/markdown-rules"
import type { Token, Tokens } from "marked"
import { type SyntheticEvent, useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/theme-provider"
import { ChatDirectoryContext, chatFileName, resolveChatLink, useOpenChatLink } from "../file-actions"
import { LinkedImage } from "./linked-image"
import { ResourceContent } from "./resource-content"
import { MermaidDiagram } from "./mermaid-diagram"

const markdown = createChatMarkdown()
const artifactExtension = /\.(?:png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|tar|gz|mp[34]|wav|ogg|webm|mov)(?:[?#].*)?$/i
const imageExtension = /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i
type Segment =
  | { key: number; text: string }
  | { key: number; link: Tokens.Link | Tokens.Image }
  | { key: number; mermaid: string }

function artifactLink(token: Token): token is Tokens.Link | Tokens.Image {
  if (token.type !== "link" && token.type !== "image") return false
  const href = (token as Tokens.Link | Tokens.Image).href
  // Source references and web links continue to use the shared Markdown renderer.
  return !/^www\.|^\/\//i.test(href) && !/^[a-z][a-z\d+.-]*:/i.test(href.replace(/^file:/i, "")) && artifactExtension.test(href)
}

function segments(text: string, streaming?: boolean): Segment[] {
  // Most messages contain neither diagrams nor local artifacts; leave parsing to the shared worker.
  if (!/```[^\n]*mermaid|~~~[^\n]*mermaid/i.test(text) && !artifactExtension.test(text) &&
    !/\.(?:png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|tar|gz|mp[34]|wav|ogg|webm|mov)(?:[?#][^\s)]*)?[)>\s]/i.test(text)) return [{ key: 0, text }]
  const tokens = markdown.lexer(text)
  if (!tokens.some(token => token.type === "code" && (token as Tokens.Code).lang?.toLowerCase() === "mermaid") &&
    !tokens.some(token => token.type === "paragraph" && (token as Tokens.Paragraph).tokens?.some(artifactLink))) return [{ key: 0, text }]
  // Keep reference definitions available in every shared-renderer segment.
  const definitions = Object.entries(tokens.links).map(([id, link]) => `\n[${id}]: <${link.href}>${link.title ? ` ${JSON.stringify(link.title)}` : ""}`).join("")
  const result: Segment[] = []
  let pending = ""
  let offset = 0
  const flush = (): void => {
    if (pending.length > 0) { result.push({ key: offset - pending.length, text: pending + definitions }); pending = "" }
  }
  for (const token of tokens) {
    const code = token.type === "code" ? (token as Tokens.Code) : undefined
    if (code?.lang?.toLowerCase() === "mermaid" && !streaming) {
      flush()
      result.push({ key: offset, mermaid: code.text })
      offset += code.raw.length
      continue
    }
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
  const cwd = useContext(ChatDirectoryContext)
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const copyLabel = t("actions.copy")
  const host = useMemo<MarkdownHost>(() => ({ theme: resolvedTheme, copyLabel, openLink }), [resolvedTheme, copyLabel, openLink])
  const parts = useMemo(() => segments(text, streaming), [text, streaming])
  // Delegate to include links introduced by the shared renderer's streaming worker.
  const showLinkAddress = (event: SyntheticEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return
    const link = event.target.closest<HTMLAnchorElement>("a[href]")
    if (!link || !event.currentTarget.contains(link)) return
    const href = link.getAttribute("href")
    if (href === null) throw new Error("Chat link is missing its address")
    const address = resolveChatLink(href, cwd)
    try {
      link.title = decodeURIComponent(address)
    } catch (error) {
      if (!(error instanceof URIError)) throw error
      link.title = address
    }
  }
  // Code blocks need a full-width containing box inside the assistant's start-aligned flex layout.
  return <div className="w-full min-w-0" onMouseOver={showLinkAddress} onFocus={showLinkAddress}>{parts.map(part => "text" in part
    ? <SharedMarkdown key={part.key} text={part.text} streaming={streaming} host={host} />
    : "mermaid" in part
      ? <MermaidDiagram key={part.key} source={part.mermaid} />
    : imageExtension.test(part.link.href)
      ? <LinkedImage key={part.key} uri={part.link.href} name={part.link.text || chatFileName(part.link.href)} />
      : <ResourceContent key={part.key} block={{ type: "resource_link", uri: part.link.href, name: part.link.text || chatFileName(part.link.href) }} />)}</div>
}
