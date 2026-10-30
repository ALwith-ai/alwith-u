import { SessionTimeline } from "@alwith/module-chat/session-timeline"
import type { Session } from "@nyssance/codex-acp-v2/client"

import { useChatHost, useTimelineSlots } from "../../src/features/chat/chat-host"
import { ChatDirectoryContext } from "../../src/features/chat/file-actions"
import { client } from "../../src/lib/client"

function Stream({ session }: { session: Session }) {
  const host = useChatHost()
  const slots = useTimelineSlots()
  return <SessionTimeline {...slots} session={session} client={client} host={host} />
}

/** U's conversation stream: the package timeline with U's host, Pane, sounds and fork actions. */
export function ChatTimeline({ session }: { session: Session }) {
  // Relative links and image paths resolve against the session's directory.
  return (
    <ChatDirectoryContext value={session.cwd}>
      <Stream session={session} />
    </ChatDirectoryContext>
  )
}
