import { type SessionListClient, type SessionListHost, SessionListProvider } from "@alwith/module-chat/session-list"
import { type ReactNode, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { chatHistoryState, chatHistoryStore } from "@/lib/chat-history"
import { client } from "@/lib/client"

import { ProjectPathAction } from "./project-path-action"

function SessionPathAction({ cwd, onOpened }: { cwd: string; onOpened: () => void }) {
  return <ProjectPathAction cwd={cwd} onOpened={onOpened} appearance="session" />
}

const historyClient: SessionListClient = {
  store: chatHistoryStore(client.store),
  get state() {
    return chatHistoryState(client.state)
  },
  listSessions: (options) => client.listSessions(options),
  listArchived: (options) => client.listArchived(options),
  renameSession: (id, name) => client.renameSession(id, name),
  fork: (id, cwd) => client.fork(id, cwd),
  archive: (id) => client.archive(id),
  unarchive: (id) => client.unarchive(id),
  delete: (id) => client.delete(id),
  stopSession: (id) => client.stopSession(id),
  activityReply: (id) => client.activityReply(id),
  projectPath: (cwd) => client.projectPath(cwd)
}

/** U's strings, toasts and folder action for `@alwith/module-chat`'s session list, over the app's client. */
export function SessionListHostProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const language = i18n.language
  const host = useMemo(
    () =>
      ({
        t: (key, values) => i18n.t(key, { ...values, ns: "alwithChat" }),
        i18n: { language },
        PathAction: SessionPathAction,
        reportError: (error) => toast.error(error instanceof Error ? error.message : String(error))
      }) satisfies SessionListHost,
    [i18n, language]
  )
  return (
    <SessionListProvider host={host} client={historyClient}>
      {children}
    </SessionListProvider>
  )
}
