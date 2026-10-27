import { createSession, type Session } from "@alwith/api"
import { ConversationBody } from "@alwith/module-chat/conversation"
import { SessionTimeline } from "@alwith/module-chat/session-timeline"
import { render } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"

import { ThemeProvider } from "@/components/theme-provider"
import { client } from "@/lib/client"

import { ChatHostProvider, useChatHost, useTimelineSlots } from "../chat-host"
import { navigationSoundStore } from "../codex/navigation-sound-store"
import { ChatComposer } from "../composer"
import { ChatDirectoryContext } from "../file-actions"

// happy-dom has no AudioContext; with sounds off the navigation rail never creates one.
navigationSoundStore.setState({ soundMode: "none" })

/** Package timeline content with U's host, for rendering a piece of it outside the stream. */
export function ChatTimelineHost({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ChatHostProvider>{children}</ChatHostProvider>
    </ThemeProvider>
  )
}

/** A running session keeps its work section open, so activity renders without expanding it. */
export function runningSession(id: string, cwd: string, items: Session["items"]): Session {
  return { ...createSession(id, cwd), state: "running", items }
}

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

function Body({ session }: { session: Session }) {
  const slots = useTimelineSlots()
  return <ConversationBody session={session} timeline={slots} />
}

export function renderTimeline(session: Session, extra?: ReactNode) {
  return render(
    <ThemeProvider>
      <ChatTimeline session={session} />
      {extra}
    </ThemeProvider>
  )
}

/** The conversation body (restoring, detached and welcome states around the timeline) with U's host. */
export function ChatBody({ session }: { session: Session }) {
  return (
    <ChatDirectoryContext value={session.cwd}>
      <ChatHostProvider>
        <Body session={session} />
      </ChatHostProvider>
    </ChatDirectoryContext>
  )
}

/** U's composer with U's host, as the conversation view mounts it. */
export function Composer(props: ComponentProps<typeof ChatComposer>) {
  return (
    <ChatTimelineHost>
      <ChatComposer {...props} />
    </ChatTimelineHost>
  )
}
