import {
  asyncQuestionId,
  asyncQuestions,
  questionReplies,
  questionReplyEnvelope
} from "@alwith/module-chat/async-question-card"
import { type CodexClient, ConfigStaleError, isText, nativeTurnId, type Session } from "@alwith/module-chat/client"

export class QuestionUnavailable extends Error {}

type Entry = { turn: string; id: string; title: string; options: string[] | null }
type Grant = Entry & { token: string; submitted: boolean }

type Attempt = {
  grant: Grant
  sessionId: string
  deviceId: string
  clientRequestId: string
  status: "sending" | "retryable" | "accepted" | "unknown"
  acknowledgeEcho: (messageId: string) => void
  messageId?: string
  repairing?: boolean
}
function questionKey(sessionId: string, question: Entry): string {
  return JSON.stringify([sessionId, question.turn, question.id, question.title, question.options])
}

type Confirmation = Pick<Attempt, "sessionId" | "deviceId" | "clientRequestId"> & { messageId: string }

function sameQuestion(a: Entry, b: Entry): boolean {
  return (
    a.turn === b.turn && a.id === b.id && a.title === b.title && JSON.stringify(a.options) === JSON.stringify(b.options)
  )
}

// Use the same native turn, replay and reply metadata as the desktop timeline.
function available(session?: Session): Entry[] {
  if (!session?.attached || session.restoring || session.readOnly || session.subagent) return []
  let latest: string | null = null
  const answered = new Set<string>()
  const questions: Entry[] = []
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i]!
    const turn = nativeTurnId(item)
    if (turn !== null && latest !== null && latest !== turn) break
    latest ??= turn
    if (item.kind === "user") {
      for (const reply of [
        ...questionReplies(item._meta),
        ...item.content.filter(isText).flatMap((b) => questionReplies(b._meta))
      ])
        answered.add(reply.questionItemId)
    } else if (item.kind === "assistant" && !item.replayed && turn !== null) {
      asyncQuestions(item._meta).forEach((q, index) =>
        questions.push({ ...q, turn, id: asyncQuestionId(item.id, index) })
      )
    }
  }
  return questions.filter((q) => !answered.has(q.id))
}

export class MobileQuestions {
  private grants = new Map<string, Map<string, Grant>>()
  // A local optimistic message or a temporary disconnect can remove a question from the projection.
  private attempts = new Map<string, Attempt>()
  private cached = new WeakMap<Session, Entry[]>()

  private entries(session?: Session): Entry[] {
    if (!session) return []
    let entries = this.cached.get(session)
    if (!entries) {
      entries = available(session)
      this.cached.set(session, entries)
    }
    return entries
  }

  private observeAttempts(state: CodexClient["state"]): void {
    for (const [key, attempt] of this.attempts) {
      const session = state.sessions[attempt.sessionId]
      if (!session) continue
      if (attempt.status === "accepted" || attempt.status === "retryable") {
        if (
          state.connection === "ready" &&
          session.attached &&
          !session.restoring &&
          !this.entries(session).some((q) => sameQuestion(q, attempt.grant))
        )
          this.attempts.delete(key)
      } else if (!attempt.messageId) {
        const echo = session.items.findLast((item) => {
          if (item.kind !== "user" || item.echo === "pending") return false
          const mobile = item._meta?.mobile
          return (
            typeof mobile === "object" &&
            mobile !== null &&
            "deviceId" in mobile &&
            mobile.deviceId === attempt.deviceId &&
            "clientRequestId" in mobile &&
            mobile.clientRequestId === attempt.clientRequestId
          )
        })
        if (echo) {
          attempt.messageId = echo.id
          attempt.acknowledgeEcho(echo.id)
        }
      }
    }
  }

  project(state: CodexClient["state"], sessions: string[]): Record<string, Record<string, string>> {
    const next = new Map<string, Map<string, Grant>>()
    const tokens: Record<string, Record<string, string>> = {}
    this.observeAttempts(state)
    for (const id of sessions) {
      const grants = new Map<string, Grant>()
      for (const question of this.entries(state.connection === "ready" ? state.sessions[id] : undefined)) {
        const key = questionKey(id, question)
        const attempt = this.attempts.get(key)
        const old = attempt?.grant ?? this.grants.get(id)?.get(question.id)
        const grant =
          old && sameQuestion(old, question) ? old : { ...question, token: crypto.randomUUID(), submitted: false }
        grants.set(question.id, grant)
        if (!grant.submitted) (tokens[id] ??= {})[question.id] = grant.token
      }
      if (grants.size) next.set(id, grants)
    }
    this.grants = next
    return tokens
  }

  async repairReceipts(write: (confirmation: Confirmation) => Promise<unknown>): Promise<void> {
    await Promise.all(
      Array.from(this.attempts.values(), async (attempt) => {
        if (attempt.status !== "unknown" || !attempt.messageId || attempt.repairing) return
        attempt.repairing = true
        try {
          const { sessionId, deviceId, clientRequestId, messageId } = attempt
          await write({ sessionId, deviceId, clientRequestId, messageId })
          attempt.status = "accepted"
        } finally {
          attempt.repairing = false
        }
      })
    )
  }

  receiptUnknown(sessionId: string, clientRequestId: string): void {
    for (const attempt of this.attempts.values()) {
      if (attempt.sessionId === sessionId && attempt.clientRequestId === clientRequestId) attempt.status = "unknown"
    }
  }

  async submit(
    client: Pick<CodexClient, "state" | "prompt">,
    sessionId: string,
    text: string,
    deviceId: string | undefined,
    clientRequestId: string
  ): Promise<string> {
    // The bridge preserves the opaque receipt ID end-to-end. Keep the answer in the normal text field.
    const [, token, nonce, extra] = clientRequestId.split("/")
    const grant = [...(this.grants.get(sessionId)?.values() ?? [])].find((g) => g.token === token)
    if (
      extra !== undefined ||
      !nonce ||
      !deviceId ||
      !text.trim() ||
      !grant ||
      grant.submitted ||
      client.state.connection !== "ready" ||
      !this.entries(client.state.sessions[sessionId]).some((q) => sameQuestion(q, grant))
    )
      throw new QuestionUnavailable("Question is no longer available")
    const reply = { questionItemId: grant.id, question: grant.title, answer: text }
    grant.submitted = true
    const key = questionKey(sessionId, grant)
    const echo = Promise.withResolvers<string>()
    const attempt: Attempt = {
      grant,
      sessionId,
      deviceId,
      clientRequestId,
      status: "sending",
      acknowledgeEcho: echo.resolve
    }
    this.attempts.set(key, attempt)
    try {
      const receipt = client.prompt(
        sessionId,
        [{ type: "text", text: questionReplyEnvelope(reply), _meta: { codex: { questionReply: reply } } }],
        { meta: { mobile: { deviceId, clientRequestId } } }
      )
      // The authoritative user message can arrive before the prompt receipt, including when the receipt is lost.
      const messageId = await Promise.race([receipt, echo.promise])
      attempt.status = "accepted"
      return messageId
    } catch (error) {
      if (error instanceof ConfigStaleError) {
        grant.submitted = false
        attempt.status = "retryable"
      }
      throw error
    }
  }
}
