import type { MessageItem, Terminal, ToolItem } from "@alwith/api"
import { CodexActivityGroup } from "@alwith/module-chat/activity"
import { ActivityHostProvider } from "@alwith/module-chat/activity-host"
import { memo, useMemo } from "react"
import { useChatActivityHost } from "./activity-host"
import { projectActivity } from "./activity-projection"

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
    </ActivityHostProvider>
  )
})
