import { ArchivedSessions } from "@alwith/module-chat/session-list"
import { ScrollArea } from "@base-ui/react/scroll-area"
import type { ReactElement, ReactNode } from "react"

import { Pane } from "@/components/alwith-ui/pane"

import { SessionListHostProvider } from "./session-list-host"

function ArchiveScroll({ children }: { children: ReactNode }) {
  return (
    <Pane className="-me-[calc(var(--app-scrollbar-track-size)+0.5rem)]">
      <ScrollArea.Content className="flex flex-col gap-8" style={{ minWidth: 0 }}>
        {children}
      </ScrollArea.Content>
    </Pane>
  )
}

/** The archived chats page: `@alwith/module-chat`'s archive in the app's scroll pane. */
export function ArchivedChatsPage(): ReactElement {
  return (
    <SessionListHostProvider>
      <ArchivedSessions Scroll={ArchiveScroll} />
    </SessionListHostProvider>
  )
}
