import { isText, type MessageItem, type Session } from "@alwith/api"
import {
  type AsyncQuestion,
  AsyncQuestionCard,
  asyncQuestionId,
  asyncQuestions,
  initialQuestionDraft,
  questionAnswer,
  type QuestionDraft,
  questionReplies,
  questionReplyEnvelope
} from "@alwith/module-chat/async-question-card"
import { useTranslation } from "react-i18next"
import { create } from "zustand"

import { nativeTurnId } from "@/agent/history-navigation"
import { client, useApp } from "@/lib/client"

type DraftEntry = { draft: QuestionDraft; pending?: boolean; accepted?: string; skipped?: boolean; error?: string }
// Only unsent UI drafts and receipt-in-flight state live here; Codex owns question/answer history.
const useDrafts = create<{ entries: Record<string, DraftEntry> }>(() => ({ entries: {} }))
function put(key: string, entry: DraftEntry) {
  useDrafts.setState((state) => ({ entries: { ...state.entries, [key]: entry } }))
}

function isActiveQuestion(session: Session, item: MessageItem): boolean {
  const turnId = nativeTurnId(item)
  const latest = session.items.findLast((entry) => nativeTurnId(entry) !== null)
  const ended = session.items.some(
    (entry) => entry.kind === "user" && nativeTurnId(entry) === turnId && session.turnEndedAt[entry.id] !== undefined
  )
  return (
    !item.replayed &&
    turnId !== null &&
    latest !== undefined &&
    session.state !== "idle" &&
    !ended &&
    nativeTurnId(latest) === turnId
  )
}

function replyIn(session: Session, id: string): string | undefined {
  for (const item of session.items) {
    if (item.kind !== "user" || item.echo === "pending") continue
    for (const reply of [
      ...questionReplies(item._meta),
      ...item.content.filter(isText).flatMap((block) => questionReplies(block._meta))
    ]) {
      if (reply.questionItemId === id) return reply.answer
    }
  }
  return undefined
}

function Question({
  sessionId,
  item,
  question,
  index
}: {
  sessionId: string
  item: MessageItem
  question: AsyncQuestion
  index: number
}) {
  const id = asyncQuestionId(item.id, index)
  const key = JSON.stringify([sessionId, id])
  const entry = useDrafts((state) => state.entries[key])
  const session = useApp((state) => state.sessions[sessionId])
  const connected = useApp((state) => state.connection === "ready")
  const { t } = useTranslation("alwithChat")
  const draft = entry?.draft ?? initialQuestionDraft(question)
  const answer = session === undefined ? entry?.accepted : (replyIn(session, id) ?? entry?.accepted)
  const active = session !== undefined && isActiveQuestion(session, item)
  const available = connected && session?.attached && !session.restoring && !session.readOnly
  const status =
    answer !== undefined
      ? "answered"
      : entry?.skipped
        ? "skipped"
        : entry?.pending
          ? "submitting"
          : !active
            ? "closed"
            : !available
              ? "unavailable"
              : "pending"
  const submit = async () => {
    if (useDrafts.getState().entries[key]?.pending || status !== "pending") return
    const latest = client.state.sessions[sessionId]
    if (
      latest === undefined ||
      !isActiveQuestion(latest, item) ||
      !latest.attached ||
      latest.readOnly ||
      latest.restoring
    )
      return
    const value = questionAnswer(question, draft)
    if (!value.trim()) return
    const reply = { questionItemId: id, question: question.title, answer: value }
    put(key, { draft, pending: true })
    try {
      await client.prompt(sessionId, [
        { type: "text", text: questionReplyEnvelope(reply), _meta: { codex: { questionReply: reply } } }
      ])
      put(key, { draft, accepted: value })
    } catch (error) {
      put(key, { draft, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (status === "closed") {
    return (
      <section className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground" aria-label={question.title}>
        <p className="whitespace-pre-wrap">{question.title}</p>
        {draft.text.trim() && <p className="whitespace-pre-wrap">{draft.text}</p>}
        <span role="status" className="text-xs">
          {t("asyncQuestion.closed")}
        </span>
      </section>
    )
  }
  return (
    <AsyncQuestionCard
      question={question}
      draft={draft}
      status={status}
      answer={answer}
      error={status === "pending" ? entry?.error : undefined}
      t={t}
      onChange={(next) => put(key, { draft: next })}
      onSkip={() => put(key, { draft, skipped: true })}
      onSubmit={() => {
        void submit()
      }}
    />
  )
}

export function AsyncQuestions({ sessionId, item }: { sessionId: string; item: MessageItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-async-questions={item.id}>
      {asyncQuestions(item._meta).map((question, index) => (
        <Question
          key={asyncQuestionId(item.id, index)}
          sessionId={sessionId}
          item={item}
          question={question}
          index={index}
        />
      ))}
    </div>
  )
}
