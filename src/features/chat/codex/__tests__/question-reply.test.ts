import { expect, test } from "vitest"
import { questionReply, questionReplyParts } from "../question-reply"

test("reads reply metadata without treating unrelated content as a questionnaire", () => {
  expect(questionReply({ codex: { questionReply: { question: "Focus?", answer: "已点" } } })).toEqual({
    question: "Focus?",
    answer: "已点"
  })
  expect(questionReply({ codex: { questionReply: { question: "Focus?", answer: "" } } })).toEqual({
    question: "Focus?",
    answer: ""
  })
  for (const value of [null, {}, { codex: null }, { codex: { questionReply: { question: "Focus?", answer: [] } } }]) {
    expect(questionReply(value)).toBeNull()
  }
})

test("validates receipt display parts before rendering", () => {
  expect(
    questionReplyParts({ codex: { questionReplyParts: [{ question: "Focus?", text: "已点" }, { text: "Context" }] } })
  ).toEqual([{ question: "Focus?", text: "已点" }, { text: "Context" }])
  for (const value of [
    null,
    {},
    { codex: { questionReplyParts: [] } },
    { codex: { questionReplyParts: [{ question: [], text: "bad" }] } }
  ])
    expect(questionReplyParts(value)).toBeNull()
})
