import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { isFormElicitation, isToolCallSubject } from "@alwith/api"
import type { PetPrompt } from "@alwith/module-auth/pets/core"
import {
  elicitationFields,
  elicitationLabels,
  elicitationOptions,
  isMultiSelect
} from "@alwith/module-chat/choice-schema"

import type { PendingAction } from "@/agent/client"

/** Mirrors Desktop's quick-answer boundary; complex forms retain their full context. */
export function petPrompt(action: PendingAction | undefined, rawInput?: unknown): PetPrompt | null {
  if (action === undefined) return null
  if (action.kind === "permission") {
    const subject = action.params.subject
    const input = rawInput ?? (subject != null && isToolCallSubject(subject) ? subject.toolCall.rawInput : undefined)
    const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : undefined
    const command = record?.command
    const commandText =
      typeof command === "string"
        ? command
        : Array.isArray(command) && command.every((part) => typeof part === "string")
          ? command.join(" ")
          : undefined
    return {
      kind: "permission",
      token: action.id,
      title: action.params.title,
      detail: [
        action.params.description,
        commandText !== undefined
          ? ""
          : rawInput === undefined
            ? action.params.subject == null
              ? ""
              : JSON.stringify(action.params.subject, null, 2)
            : JSON.stringify(rawInput, null, 2)
      ]
        .filter(Boolean)
        .join("\n"),
      ...(commandText === undefined
        ? {}
        : { command: { text: commandText, ...(typeof record?.cwd === "string" ? { cwd: record.cwd } : {}) } }),
      options: action.params.options
        .filter((option) => option.kind === "allow_once" || option.kind === "reject_once")
        .map((option) => ({
          id: option.optionId,
          label: option.name,
          decision: option.kind === "allow_once" ? ("allow" as const) : ("reject" as const)
        }))
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
    options: options.every((option) => !option.preview && !option.description)
      ? options.map((option) => ({ id: option.value, label: option.label }))
      : []
  }
}

export function petAnswer(
  action: PendingAction,
  optionId: string
): acp.RequestPermissionResponse | acp.CreateElicitationResponse {
  if (!petPrompt(action)?.options.some((option) => option.id === optionId))
    throw new Error("This question or permission choice is unavailable in the pet bubble")
  if (action.kind === "permission") return { outcome: { outcome: "selected", optionId } }
  if (!isFormElicitation(action.params)) throw new Error("Open this question in the full conversation")
  const [field] = elicitationFields(action.params.requestedSchema)
  return { action: "accept", content: { [field.key]: optionId } }
}
