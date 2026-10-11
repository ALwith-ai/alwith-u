import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import { isFormElicitation } from "@alwith/api"
import {
  elicitationFields,
  elicitationLabels,
  elicitationOptions,
  isMultiSelect
} from "@alwith/module-chat/choice-schema"
import type { PetPrompt } from "@alwith/module-vibemon"
import type { PendingAction } from "@/agent/client"

/** Mirrors Desktop's quick-answer boundary; complex forms retain their full context. */
export function petPrompt(action: PendingAction | undefined, rawInput?: unknown): PetPrompt | null {
  if (action === undefined) return null
  if (action.kind === "permission") {
    return {
      kind: "permission",
      token: action.id,
      title: action.params.title,
      detail: [
        action.params.description,
        rawInput === undefined
          ? action.params.subject == null
            ? ""
            : JSON.stringify(action.params.subject, null, 2)
          : JSON.stringify(rawInput, null, 2)
      ]
        .filter(Boolean)
        .join("\n"),
      options: action.params.options
        .filter(option => option.kind === "allow_once" || option.kind === "reject_once")
        .map(option => ({ id: option.optionId, label: option.name }))
    }
  }
  if (!isFormElicitation(action.params))
    return { kind: "question", token: action.id, title: action.params.message, detail: "", options: [] }
  const fields = elicitationFields(action.params.requestedSchema)
  const field = fields.length === 1 && !isMultiSelect(fields[0].property) ? fields[0] : null
  const options = field === null ? [] : elicitationOptions(field.property)
  const labels = field === null ? {} : elicitationLabels(field.property)
  return {
    kind: "question",
    token: action.id,
    title: action.params.message,
    detail: [labels.title, labels.description].filter(Boolean).join("\n"),
    options: options.every(option => !option.preview && !option.description)
      ? options.map(option => ({ id: option.value, label: option.label }))
      : []
  }
}

export function petAnswer(
  action: PendingAction,
  optionId: string
): acp.RequestPermissionResponse | acp.CreateElicitationResponse {
  if (!petPrompt(action)?.options.some(option => option.id === optionId))
    throw new Error("This question or permission choice is unavailable in the pet bubble")
  if (action.kind === "permission") return { outcome: { outcome: "selected", optionId } }
  if (!isFormElicitation(action.params)) throw new Error("Open this question in the full conversation")
  const [field] = elicitationFields(action.params.requestedSchema)
  return { action: "accept", content: { [field.key]: optionId } }
}
