import { isEmbeddedResource, isImage, isResourceLink, type MessageItem } from "@alwith/api"
import { CodexUserMessage } from "@alwith/module-chat/user-message"
import { memo } from "react"
import { messageText } from "../turns"
import { useChatActivityHost } from "./activity-host"
import { ResourceContent } from "./resource-content"

export const UserMessage = memo(function UserMessage({ item }: { item: MessageItem }) {
  const host = useChatActivityHost()
  const text = messageText(item)
  const images = item.content.filter(isImage)
  const resources = item.content.filter(block => isResourceLink(block) || isEmbeddedResource(block))
  if (text.length === 0 && images.length === 0 && resources.length === 0) return null
  return (
    <div data-content-search-unit-key={item.id}>
      {resources.length > 0 && (
        <div className="codex-user-mentions">
          {resources.map((block, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ACP resource blocks have no IDs; their positions identify them.
            <ResourceContent key={`${item.id}:${index}`} block={block} />
          ))}
        </div>
      )}
      <CodexUserMessage host={host} message={item} text={text} images={images} mentions={[]} messageTime={null} />
    </div>
  )
})
