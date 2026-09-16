import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import type { MessageItem, Terminal, ToolItem } from "@alwith/api"
import { CodexActivityGroup } from "@alwith/chat/activity"
import { ActivityHostProvider } from "@alwith/chat/activity-host"
import { memo, useMemo } from "react"
import { useChatActivityHost } from "./activity-host"
import { projectActivity } from "./activity-projection"

export function isToolActive(status: acp.ToolCallStatus | null): boolean {
  return status === null || status === "pending" || status === "in_progress"
}

export const ActivityGroup = memo(function ActivityGroup({ items, terminals, streaming }: {
  items: Array<MessageItem | ToolItem>
  terminals: Record<string, Terminal>
  streaming: boolean
}) {
  const host = useChatActivityHost()
  const blocks = useMemo(() => items.map(item => projectActivity(item, terminals, streaming)), [items, terminals, streaming])
  return <ActivityHostProvider host={host}><CodexActivityGroup blocks={blocks} /></ActivityHostProvider>
})
