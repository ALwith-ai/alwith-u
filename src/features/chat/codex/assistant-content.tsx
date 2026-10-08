import { type ContentBlock, ContentBlock as ContentBlockGuard } from "@agentclientprotocol/sdk/experimental/v2"
import { isEmbeddedResource, isResourceLink } from "@alwith/api"
import type { ReactElement } from "react"
import { useTranslation } from "react-i18next"
import { CodexMarkdownRenderer } from "./markdown-renderer"
import { ResourceContent } from "./resource-content"

function AssistantContentBlock({ block, streaming }: { block: ContentBlock; streaming: boolean }): ReactElement | null {
  const { t } = useTranslation()
  if (ContentBlockGuard.isText(block)) {
    if (block.text.length === 0) return null
    return (
      <div className="codex-assistant-message">
        <CodexMarkdownRenderer text={block.text} streaming={streaming} />
      </div>
    )
  }
  if (ContentBlockGuard.isImage(block)) return <ResourceContent block={block} />
  if (ContentBlockGuard.isAudio(block))
    // ACP audio blocks do not carry captions or a transcript.
    // biome-ignore lint/a11y/useMediaCaption: The protocol supplies audio data only.
    return <audio controls src={`data:${block.mimeType};base64,${block.data}`} />
  if (isResourceLink(block) || isEmbeddedResource(block)) return <ResourceContent block={block} />
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
