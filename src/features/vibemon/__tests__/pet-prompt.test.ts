import { expect, test } from "vitest"
import type { PendingAction } from "@/agent/client"
import { petAnswer, petPrompt } from "../pet-prompt"

function question(properties: Record<string, unknown>): PendingAction {
  return {
    id: "question-token",
    kind: "elicitation",
    sessionId: "one",
    params: {
      mode: "form",
      message: "Choose a direction",
      requestedSchema: { type: "object", properties }
    }
  } as PendingAction
}
const choices = {
  type: "string",
  title: "Direction",
  oneOf: [
    { const: "left", title: "Left" },
    { const: "right", title: "Right" }
  ]
}
test("simple single-choice questions reuse the original form property and token", () => {
  const action = question({ direction: choices })
  expect(petPrompt(action)).toEqual({
    kind: "question",
    token: "question-token",
    title: "Choose a direction",
    detail: "Direction",
    options: [
      { id: "left", label: "Left" },
      { id: "right", label: "Right" }
    ]
  })
  expect(petAnswer(action, "right")).toEqual({ action: "accept", content: { direction: "right" } })
})
test("multiple questions, multiple selection and text stay in the full conversation", () => {
  for (const fields of [
    { direction: choices, other: choices },
    { direction: { type: "array", items: choices } },
    { direction: { type: "string" } }
  ]) {
    const action = question(fields)
    expect(petPrompt(action)?.options).toEqual([])
    expect(() => petAnswer(action, "left")).toThrow("unavailable")
  }
})
test("option previews and descriptions are never discarded for a quick answer", () => {
  for (const option of [
    { const: "left", title: "Left", description: "Requires changing files" },
    { const: "left", title: "Left", _meta: { alwith: { preview: "patch" } } }
  ]) {
    const action = question({ direction: { ...choices, oneOf: [option] } })
    expect(petPrompt(action)?.options).toEqual([])
    expect(() => petAnswer(action, "left")).toThrow("unavailable")
  }
})
test("permission bubbles expose once-only options and preserve their operation context", () => {
  const action: PendingAction = {
    id: "permission-token",
    kind: "permission",
    sessionId: "one",
    params: {
      sessionId: "one",
      title: "Run command?",
      description: "Run in this project",
      options: [
        { optionId: "yes", name: "Allow once", kind: "allow_once" },
        { optionId: "always", name: "Always allow", kind: "allow_always" },
        { optionId: "no", name: "Reject once", kind: "reject_once" }
      ]
    }
  }
  expect(petPrompt(action, { command: "ls" })?.detail).toContain('"command": "ls"')
  expect(petPrompt(action)?.options.map(option => option.id)).toEqual(["yes", "no"])
  expect(petAnswer(action, "yes")).toEqual({ outcome: { outcome: "selected", optionId: "yes" } })
  expect(() => petAnswer(action, "always")).toThrow("unavailable")
})
test("URL questions open their complete UI rather than fabricating a response", () => {
  const action: PendingAction = {
    id: "url",
    kind: "elicitation",
    sessionId: "one",
    params: {
      mode: "url",
      sessionId: "one",
      elicitationId: "url",
      message: "Authorize",
      url: "https://example.test/auth"
    }
  }
  expect(petPrompt(action)?.options).toEqual([])
  expect(() => petAnswer(action, "accept")).toThrow("unavailable")
})
