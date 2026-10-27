import { type SessionListHost, SessionListProvider } from "@alwith/module-chat/session-list"
import { type ReactNode, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { client } from "@/lib/client"

import { ProjectPathAction } from "./project-path-action"

function SessionPathAction({ cwd, onOpened }: { cwd: string; onOpened: () => void }) {
  return <ProjectPathAction cwd={cwd} onOpened={onOpened} appearance="session" />
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
    <SessionListProvider host={host} client={client}>
      {children}
    </SessionListProvider>
  )
}
