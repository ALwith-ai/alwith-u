import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import type { FormElicitation } from "@alwith/api"
import { SchemaElicitationForm } from "@alwith/module-chat/schema-elicitation-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { PendingAction } from "@/agent/client"
import { client } from "@/lib/client"
export { elicitationFields, initialValues, isAnswered } from "@alwith/module-chat/schema-elicitation-form"
export type FormAction = PendingAction & { kind: "elicitation"; params: FormElicitation }
export function ElicitationFormDialog({ action, total }: { action: FormAction; total: number }) {
  const { t } = useTranslation()
  const respond = (answer: acp.CreateElicitationResponse) => {
    try {
      client.respond(action.id, answer)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <SchemaElicitationForm
      requestId={action.id}
      schema={action.params.requestedSchema}
      message={action.params.message}
      total={total}
      t={t}
      onRespond={respond}
    />
  )
}
