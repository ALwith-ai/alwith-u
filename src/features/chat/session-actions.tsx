import { isFormElicitation } from "@alwith/api"
import { useShallow } from "zustand/react/shallow"

import type { PendingAction } from "@/agent/client"
import { useApp } from "@/lib/client"

import { ActionCard } from "./action-card"
import { ElicitationFormDialog, type FormAction } from "./dialogs/elicitation-form-dialog"

function isFormAction(action: PendingAction): action is FormAction {
  return action.kind === "elicitation" && isFormElicitation(action.params)
}

/** Pending requests belong to the session, including before its first prompt is acknowledged. */
export function SessionActions({ sessionId }: { sessionId: string }) {
  const actions = useApp(useShallow((state) => state.actions.filter((action) => action.sessionId === sessionId)))
  const forms = actions.filter(isFormAction)
  const inline = actions.filter((action) => !isFormAction(action))
  return (
    <>
      {inline.length > 0 && (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pb-3">
          {inline.map((action) => (
            <ActionCard key={action.id} action={action} />
          ))}
        </div>
      )}
      {forms[0] !== undefined && <ElicitationFormDialog key={forms[0].id} action={forms[0]} total={forms.length} />}
    </>
  )
}
