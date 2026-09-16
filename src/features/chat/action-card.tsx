import { UrlElicitationCard } from "@alwith/chat/url-elicitation-card"
// Permission requests and elicitations from the agent. Every answer maps back to
// an option the agent advertised; nothing is invented on the client.
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { PermissionView } from "@alwith/chat/permission-view"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { PendingAction } from "@/agent/client"
import { isContentEntry, isDiffEntry, isText, isToolCallSubject, isUrlElicitation } from "@alwith/api"
import { client } from "@/lib/client"
import { openExternal } from "@/lib/open"
import { PatchView } from "./codex/patch-view"
function optionDescription(option: acp.PermissionOption): string | null {
  const codex = option._meta?.codex
  if (typeof codex !== "object" || codex === null) return null
  const description = (codex as { description?: unknown }).description
  return typeof description === "string" ? description : null
}

function subjectCommand(toolCall: acp.ToolCallUpdate): string | null {
  const input = toolCall.rawInput
  if (typeof input !== "object" || input === null) return null
  const command = (input as { command?: unknown }).command
  if (typeof command === "string") return command
  if (Array.isArray(command)) return command.map(String).join(" ")
  return null
}

function subjectPatch(toolCall: acp.ToolCallUpdate): string | null {
  for (const entry of toolCall.content ?? []) {
    if (isDiffEntry(entry) && entry.patch && entry.patch.text.length > 0) return entry.patch.text
  }
  return null
}

function subjectText(toolCall: acp.ToolCallUpdate): string {
  return (toolCall.content ?? [])
    .filter(isContentEntry)
    .map(entry => (isText(entry.content) ? entry.content.text : ""))
    .filter(text => text.length > 0)
    .join("\n")
}

function Subject({ subject }: { subject: acp.RequestPermissionSubject }) {
  if (!isToolCallSubject(subject)) return null
  const toolCall = subject.toolCall
  const command = subjectCommand(toolCall)
  const patch = subjectPatch(toolCall)
  const text = subjectText(toolCall)
  return (
    <div className="flex flex-col gap-2">
      {toolCall.title && command === null && <div className="text-sm font-medium">{toolCall.title}</div>}
      {command !== null && (
        <pre className="bg-muted overflow-x-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
          <span className="text-muted-foreground select-none">$ </span>
          {command}
        </pre>
      )}
      {patch !== null && (
        <div className="max-h-80 overflow-auto rounded-lg border" data-stream-style="codexUI">
          <PatchView patch={patch} />
        </div>
      )}
      {patch === null && command === null && text.length > 0 && (
        <pre className="bg-muted max-h-60 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">
          {text}
        </pre>
      )}
      {(toolCall.locations ?? []).length > 0 && (
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
          {(toolCall.locations ?? []).map(location => (
            <li key={`${location.path}:${location.line ?? ""}`} className="truncate font-mono">
              {location.path}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type ActionResponder = (
  actionId: string,
  answer: acp.RequestPermissionResponse | acp.CreateElicitationResponse
) => void | Promise<void>

function respond(action: PendingAction, answer: acp.RequestPermissionResponse | acp.CreateElicitationResponse) {
  try {
    client.respond(action.id, answer)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Options keep Desktop's stable order (allow before reject, once before always) so the digit
 * keys mean the same thing whatever order the agent sent. Keys while the card has focus:
 * 1-4 pick, Esc cancels.
 */
function PermissionCard({
  action,
  onRespond
}: {
  action: PendingAction & { kind: "permission" }
  onRespond: ActionResponder
}) {
  const { t } = useTranslation()
  const params = action.params
  return (
    <PermissionView
      requestId={action.id}
      title={params.title}
      alwaysLabel={t("approval.always")}
      autoFocus="if-idle"
      options={params.options.map(option => ({ ...option, description: optionDescription(option) ?? undefined }))}
      onRespond={optionId =>
        onRespond(action.id, {
          outcome: optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId }
        })
      }>
      {params.description && <div className="text-muted-foreground mt-0.5 text-xs">{params.description}</div>}
      {params.subject && <Subject subject={params.subject} />}
    </PermissionView>
  )
}

/** URL elicitations stay inline; form elicitations open `ElicitationFormDialog` from the chat view. */
function ElicitationCard({
  action,
  onRespond
}: {
  action: PendingAction & { kind: "elicitation" }
  onRespond: ActionResponder
}) {
  const { t } = useTranslation()
  const params = action.params
  if (!isUrlElicitation(params)) throw new Error("Form elicitations are answered in ElicitationFormDialog")
  return (
    <UrlElicitationCard
      message={params.message}
      url={params.url}
      t={t}
      onOpen={openExternal}
      onRespond={answer => onRespond(action.id, { action: answer })}
    />
  )
}

export function ActionCard({
  action,
  onRespond = (_id, answer) => respond(action, answer)
}: {
  action: PendingAction
  onRespond?: ActionResponder
}) {
  return action.kind === "permission" ? (
    <PermissionCard action={action} onRespond={onRespond} />
  ) : (
    <ElicitationCard action={action} onRespond={onRespond} />
  )
}
