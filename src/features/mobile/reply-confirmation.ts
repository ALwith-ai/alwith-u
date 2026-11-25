// The adapter's respond() returns before the ACP SDK dispatches acpRespond. Only the
// Runtime port can confirm the write. Numeric and string JSON-RPC ids stay distinct.
const writes = new Map<string, { sent: (write: Promise<void>) => void; fail: (error: Error) => void }>()

export function observeActionWrite(agent: string, id: unknown, failure: unknown, write: Promise<void>): void {
  if (agent !== "codex") return
  const key = JSON.stringify(id)
  const pending = writes.get(key)
  if (!pending) return
  if (failure != null) pending.fail(new Error("The agent request was withdrawn"))
  else pending.sent(write)
}

export function expireActionWrites(): void {
  for (const pending of writes.values()) pending.fail(new Error("The agent connection changed"))
  writes.clear()
}

export async function confirmedActionWrite(actionId: string, send: () => void): Promise<void> {
  if (writes.has(actionId)) throw new Error("An answer is already in progress")
  const confirmation = Promise.withResolvers<void>()
  const pending = {
    sent: (write: Promise<void>) => {
      void write.then(confirmation.resolve, confirmation.reject)
    },
    fail: confirmation.reject
  }
  writes.set(actionId, pending)
  const timer = setTimeout(() => pending.fail(new Error("Runtime response confirmation timed out")), 15_000)
  try {
    send()
    await confirmation.promise
  } finally {
    clearTimeout(timer)
    if (writes.get(actionId) === pending) writes.delete(actionId)
  }
}
