import { basename } from "@/lib/path"
import { isEmbeddedResource, isImage, isResourceLink, type MessageItem } from "@alwith/api"
import { CodexUserMessage, type MessageMention } from "@alwith/module-chat/user-message"
import { memo } from "react"
import { messageText } from "../turns"
import { useChatActivityHost } from "./activity-host"

export const UserMessage = memo(function UserMessage({ item }: { item: MessageItem }) {
  const host = useChatActivityHost()
  const text = messageText(item)
  const images = item.content.filter(isImage)
  const mentions: MessageMention[] = item.content.flatMap((block, index) => {
    if (isResourceLink(block)) return [{ key: index + ":" + block.uri, label: block.title ?? block.name, title: block.title ?? block.name }]
    if (isEmbeddedResource(block)) {
      const uri = (block.resource as { uri?: unknown }).uri
      if (typeof uri === "string") return [{ key: index + ":" + uri, label: basename(uri), title: basename(uri) }]
    }
    return []
  })
  if (text.length === 0 && images.length === 0 && mentions.length === 0) return null
  return <CodexUserMessage host={host} message={item} text={text} images={images} mentions={mentions} messageTime={null} />
})
