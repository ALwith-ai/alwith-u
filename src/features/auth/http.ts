import type { createTokenStorage } from "@alwith/module-auth"

type Storage = ReturnType<typeof createTokenStorage>
interface Host {
  baseUrl: string
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  storage: Storage
  refresh(token: string): Promise<{ access_token: string; refresh_token: string }>
  expired(): Promise<void>
}

/** App transport only: authentication contracts and native refresh belong to @alwith/module-auth. */
export function createAuthTransport(host: Host) {
  let revision = 0
  let pending: Promise<void> | undefined
  const current = (expected: number) => {
    if (revision !== expected) throw new Error("Authentication changed during request")
  }
  async function refresh(expected: number) {
    if (pending) return pending
    const work = (async () => {
      const token = await host.storage.tokenStorage.getRefresh()
      current(expected)
      try {
        if (!token) throw { kind: "unauthorized" }
        const result = await host.refresh(token)
        current(expected)
        await host.storage.tokenStorage.save(result.access_token, result.refresh_token)
      } catch (error) {
        current(expected)
        if (typeof error === "object" && error !== null && "kind" in error && error.kind === "unauthorized") {
          revision++
          await host.expired()
        }
        throw error
      }
    })()
    pending = work
    try {
      await work
    } finally {
      if (pending === work) pending = undefined
    }
  }
  async function request<T>(path: string, method: "GET" | "POST", body?: unknown, authenticated = true): Promise<T> {
    if (!path.startsWith("/api/v1/")) throw new Error("Invalid ALwith API path")
    const expected = revision
    let sentToken = ""
    async function send() {
      const token = authenticated ? await host.storage.tokenStorage.getAccess() : ""
      sentToken = token
      current(expected)
      return host.fetch(`${host.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        redirect: "error"
      })
    }
    let response = await send()
    current(expected)
    if (authenticated && (response.status === 401 || response.status === 403)) {
      // A delayed 401 may belong to the token another request already rotated.
      if ((await host.storage.tokenStorage.getAccess()) === sentToken) await refresh(expected)
      current(expected)
      response = await send()
      current(expected)
    }
    if (!response.ok) {
      let detail: string | undefined
      try {
        const error: unknown = await response.json()
        if (error && typeof error === "object" && "detail" in error && typeof error.detail === "string")
          detail = error.detail.trim() || undefined
      } catch {
        // Error bodies may be empty or HTML. Only the API's detail field is user-facing.
      }
      current(expected)
      throw new Error(detail ?? `ALwith HTTP ${response.status}`)
    }
    const text = await response.text()
    current(expected)
    // Void endpoints such as send-code can return 200 with an empty body.
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }
  return {
    request,
    // Wait for an already-started save before replacing/clearing the account.
    async invalidate() {
      revision++
      await pending?.catch(() => {})
    }
  }
}
