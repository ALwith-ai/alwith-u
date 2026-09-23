import { ContentBlock as ContentBlockGuard, type ContentBlock } from "@agentclientprotocol/sdk/experimental/v2"
import { useActivityHost } from "@alwith/module-chat/activity-host"
import type { ReactElement } from "react"
import { useTranslation } from "react-i18next"
import { openImageLightbox } from "../dialogs/image-lightbox"
import { CodexMarkdownRenderer } from "./markdown-renderer"

function AssistantContentBlock({ block, streaming }: { block: ContentBlock; streaming: boolean }): ReactElement | null {
  const host = useActivityHost()
  const { t } = useTranslation()
  if (ContentBlockGuard.isText(block)) {
    if (block.text.length === 0) return null
    return (
      <div className="codex-assistant-message">
        <CodexMarkdownRenderer text={block.text} streaming={streaming} />
      </div>
    )
  }
  if (ContentBlockGuard.isImage(block)) {
    const src = `data:${block.mimeType};base64,${block.data}`
    return (
      <button type="button" aria-label={t("chat.image.view")} onClick={() => openImageLightbox(src)}>
        <img src={src} className="max-h-64 rounded" alt="" />
      </button>
    )
  }
  if (ContentBlockGuard.isAudio(block))
    // ACP audio blocks do not carry captions or a transcript.
    // biome-ignore lint/a11y/useMediaCaption: The protocol supplies audio data only.
    return <audio controls src={`data:${block.mimeType};base64,${block.data}`} />
  if (ContentBlockGuard.isResourceLink(block))
    return (
      <button type="button" onClick={() => host.openLink(block.uri)}>
        {block.title ?? block.name}
      </button>
    )
  if (ContentBlockGuard.isResource(block)) {
    const resource = block.resource
    return "text" in resource ? (
      <pre className="overflow-x-auto whitespace-pre-wrap">{resource.text}</pre>
    ) : (
      <a href={`data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`} download>
        {resource.uri}
      </a>
    )
  }
  return <div className="text-muted-foreground">{t("chat.content.unsupported", { type: block.type })}</div>
}

export function AssistantContent({
  content,
  messageId,
  streaming
}: {
  content: ContentBlock[]
  messageId: string
  streaming: boolean
}): ReactElement[] {
  return content.map((block, index) => (
    // ACP message blocks have no individual IDs; their position stays stable as chunks append.
    // biome-ignore lint/suspicious/noArrayIndexKey: Stable block position preserves streaming Markdown state.
    <AssistantContentBlock key={`${messageId}:${index}`} block={block} streaming={streaming} />
  ))
}
