import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event"

type RefreshScope = "account" | "enterprise"
const channels = {
  account: { request: "alwith-providers-refresh-request", result: "alwith-providers-refresh-result" },
  enterprise: {
    request: "alwith-enterprise-providers-refresh-request",
    result: "alwith-enterprise-providers-refresh-result"
  }
} satisfies Record<RefreshScope, { request: string; result: string }>
type Events = { listen: typeof listen; emitTo: typeof emitTo }
type Request = { id: string; window: string }
type Result = { id: string; error: string | null }

/** Resolve only after main has fetched and saved the account's model configuration. */
export function createProviderRefreshClient(
  window: string,
  events: Events = { listen, emitTo },
  scope: RefreshScope = "account"
): () => Promise<void> {
  const channel = channels[scope]
  let pending: Promise<void> | null = null
  async function request(): Promise<void> {
    const id = crypto.randomUUID()
    let resolve!: (value: Result) => void
    let reject!: (error: Error) => void
    const result = new Promise<Result>((done, fail) => {
      resolve = done
      reject = fail
    })
    const stop = await events.listen<Result>(channel.result, ({ payload }) => {
      if (payload.id === id) resolve(payload)
    })
    const timer = setTimeout(
      () =>
        reject(
          new Error(scope === "account" ? "ALwith model refresh timed out" : "Enterprise model refresh timed out")
        ),
      60_000
    )
    try {
      const [, response] = await Promise.all([
        events.emitTo("main", channel.request, { id, window } satisfies Request),
        result
      ])
      if (response.error !== null) throw new Error(response.error)
    } finally {
      clearTimeout(timer)
      stop()
    }
  }
  return () => {
    pending ??= request().finally(() => {
      pending = null
    })
    return pending
  }
}

export function serveProviderRefresh(
  refresh: () => Promise<void>,
  events: Events = { listen, emitTo },
  scope: RefreshScope = "account"
): Promise<UnlistenFn> {
  const channel = channels[scope]
  return events.listen<Request>(channel.request, ({ payload }) => {
    void (async () => {
      let error: string | null = null
      try {
        await refresh()
      } catch (cause) {
        error =
          cause instanceof Error
            ? cause.message
            : typeof cause === "object" && cause !== null && "message" in cause
              ? String(cause.message)
              : String(cause)
      }
      await events.emitTo(payload.window, channel.result, { id: payload.id, error } satisfies Result)
    })().catch((error: unknown) => console.error("ALwith model refresh response failed", error))
  })
}
