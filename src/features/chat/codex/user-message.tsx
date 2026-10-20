import { isEmbeddedResource, isImage, isResourceLink, isText, type MessageItem } from "@alwith/api"
import { CodexUserMessage } from "@alwith/module-chat/user-message"
import { memo } from "react"

import { messageText } from "../turns"
import { useChatActivityHost } from "./activity-host"
import { questionReply, questionReplyParts } from "./question-reply"
import { ResourceContent } from "./resource-content"

export const UserMessage = memo(function UserMessage({
  item,
  messageTime
}: {
  item: MessageItem
  messageTime: { short: string; full: string } | null
}) {
  const host = useChatActivityHost()
  const receiptParts = questionReplyParts(item._meta)
  const text = receiptParts
    ? receiptParts.map(part => (part.question === undefined ? part.text : `${part.question}\n${part.text}`)).join("\n")
    : messageText(item)
  const images = item.content.filter(isImage)
  const resources = item.content.filter(block => isResourceLink(block) || isEmbeddedResource(block))
  const textParts =
    receiptParts ??
    item.content.filter(isText).map(block => {
      const reply = questionReply(block._meta)
      return reply ? { question: reply.question, text: reply.answer } : { text: block.text }
    })
  if (text.length === 0 && images.length === 0 && resources.length === 0) return null
  return (
    <div className="group/codex-user flex min-w-0 flex-col items-end gap-2" data-content-search-unit-key={item.id}>
      {resources.length > 0 && (
        <div className="codex-user-mentions">
          {resources.map((block, index) => (
            <ResourceContent key={`${item.id}:${index}`} block={block} />
          ))}
        </div>
      )}
      <CodexUserMessage
        host={host}
        message={item}
        text={text}
        textParts={textParts.some(part => "question" in part) ? textParts : undefined}
        images={images}
        mentions={[]}
        messageTime={messageTime}
      />
    </div>
  )
})
