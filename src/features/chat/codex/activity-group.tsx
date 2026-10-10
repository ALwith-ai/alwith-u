import type { MessageItem, Terminal, ToolItem } from "@alwith/api"
import { isContentEntry, isEmbeddedResource, isResourceLink } from "@alwith/api"
import { CodexActivityGroup } from "@alwith/module-chat/activity"
import { ActivityHostProvider } from "@alwith/module-chat/activity-host"
import { memo, useMemo, type ReactElement } from "react"
import { useChatActivityHost } from "./activity-host"
import { projectActivity } from "./activity-projection"
import { ResourceContent } from "./resource-content"

function ToolResources({ item }: { item: ToolItem }): ReactElement | null {
  const resources = item.content
    .filter(isContentEntry)
    .filter(part => isEmbeddedResource(part.content) || isResourceLink(part.content))
  if (resources.length === 0) return null
  return (
    <fieldset className="mt-1 min-w-0">
      <legend className="text-muted-foreground text-xs">{item.title ?? item.name}</legend>
      {resources.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ACP resource blocks have no IDs; their positions identify them.
        <ResourceContent key={`${item.id}:${index}`} block={part.content} />
      ))}
    </fieldset>
  )
}

export const ActivityGroup = memo(function ActivityGroup({
  items,
  terminals,
  streaming
}: {
  items: Array<MessageItem | ToolItem>
  terminals: Record<string, Terminal>
  streaming: boolean
}) {
  const host = useChatActivityHost()
  const blocks = useMemo(
    () => items.map(item => projectActivity(item, terminals, streaming)),
    [items, terminals, streaming]
  )
  return (
    <ActivityHostProvider host={host}>
      <CodexActivityGroup blocks={blocks} />
      {items.map(item => item.kind === "tool" && <ToolResources key={item.id} item={item} />)}
    </ActivityHostProvider>
  )
})
