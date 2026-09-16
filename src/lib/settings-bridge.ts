// What the settings window needs from the main window's agent connection: the engine
// identity for About and the sign-out action. The settings window has no ACP client of
// its own (a second client would attach the sessions away from the main window), so the
// two windows talk over events, as ALwith Desktop's windows do.
import { emitTo, listen } from "@tauri-apps/api/event"
import * as React from "react"
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import type { PendingAction } from "@/agent/client"
import { toast } from "sonner"
import type { AccountReadResponse, RateLimitSnapshot } from "@/agent/codex-extensions"

export type SettingsEvents = { listen: typeof listen; emitTo: typeof emitTo }
const nativeEvents: SettingsEvents = { listen, emitTo }

export type SettingsAgent = {
  name: string
  version: string
  authMethods: acp.AuthMethod[]
  actions: PendingAction[]
} | null
/** `null` while the agent is not connected or does not expose the account methods. */
export type SettingsAccount = { account: AccountReadResponse; rateLimits: RateLimitSnapshot | null } | null

const REQUEST_AGENT = "settings:request-agent"
const AGENT = "settings:agent"
const AUTH_REQUEST = "settings:auth-request"
const AUTH_RESULT = "settings:auth-result"
const REQUEST_ACCOUNT = "settings:request-account"
const ACCOUNT = "settings:account"

type AuthRequest = { id: string } & (
  | { action: "login"; methodId: string; extra: Record<string, unknown> }
  | { action: "logout" }
  | { action: "respond"; actionId: string; answer: acp.RequestPermissionResponse | acp.CreateElicitationResponse }
)
type AuthResult = { id: string; error: string | null }
const ACCOUNT_ERROR = "settings:account-error"

/** Main window: answers the settings window's requests. */
export function serveSettingsBridge(
  options: {
    agent: () => SettingsAgent
    subscribe: (listener: () => void) => () => void
    logout: () => Promise<void>
    login: (methodId: string, extra: Record<string, unknown>) => Promise<void>
    respond: (actionId: string, answer: acp.RequestPermissionResponse | acp.CreateElicitationResponse) => void
    /** Account + rate limits from the agent; `null` when unavailable. */
    account: () => Promise<SettingsAccount>
    /** Rolling rate-limit updates; the callback receives each snapshot. */
    onRateLimits: (listener: (limits: RateLimitSnapshot) => void) => () => void
  },
  events: SettingsEvents = nativeEvents
): () => void {
  const { listen, emitTo } = events
  let lastAgent = options.agent()
  const publish = () => {
    const agent = options.agent()
    void emitTo("settings", AGENT, agent)
    if ((lastAgent === null) !== (agent === null)) void publishAccount()
    lastAgent = agent
  }
  let lastAccount: SettingsAccount = null
  let revision = 0
  let disposed = false
  const publishAccount = async () => {
    const current = ++revision
    try {
      const account = await options.account()
      if (disposed || current !== revision) return
      lastAccount = account
      await emitTo("settings", ACCOUNT, lastAccount)
    } catch (error) {
      if (disposed || current !== revision) return
      await emitTo("settings", ACCOUNT_ERROR, error instanceof Error ? error.message : String(error))
    }
  }
  const unsubscribe = options.subscribe(publish)
  const stopLimits = options.onRateLimits(limits => {
    if (lastAccount === null) return
    lastAccount = { ...lastAccount, rateLimits: limits }
    void emitTo("settings", ACCOUNT, lastAccount)
  })
  const stops = Promise.all([
    listen(REQUEST_AGENT, publish),
    listen(REQUEST_ACCOUNT, () => void publishAccount()),
    listen<AuthRequest>(AUTH_REQUEST, async ({ payload: request }) => {
      try {
        switch (request.action) {
          case "login":
            await options.login(request.methodId, request.extra)
            await publishAccount()
            break
          case "logout":
            await options.logout()
            await publishAccount()
            break
          case "respond":
            options.respond(request.actionId, request.answer)
            break
        }
        await emitTo("settings", AUTH_RESULT, { id: request.id, error: null } satisfies AuthResult)
      } catch (error) {
        await emitTo("settings", AUTH_RESULT, {
          id: request.id,
          error: error instanceof Error ? error.message : String(error)
        } satisfies AuthResult)
      }
    })
  ])
  return () => {
    disposed = true
    revision++
    unsubscribe()
    stopLimits()
    void stops.then(fns => fns.forEach(stop => stop()))
  }
}

/** Settings window: the main window's account + rate limits, `undefined` until the first answer. */
export function useSettingsAccount(): SettingsAccount | undefined {
  const [account, setAccount] = React.useState<SettingsAccount | undefined>(undefined)
  React.useEffect(() => {
    let disposed = false
    const stops = Promise.all([
      listen<SettingsAccount>(ACCOUNT, event => {
        if (!disposed) setAccount(event.payload)
      }),
      listen<string>(ACCOUNT_ERROR, event => {
        if (disposed) return
        setAccount(null)
        toast.error(event.payload)
      })
    ])
    void stops.then(() => {
      if (!disposed) return emitTo("main", REQUEST_ACCOUNT)
    })
    return () => {
      disposed = true
      void stops.then(fns => fns.forEach(stop => stop()))
    }
  }, [])
  return account
}

/** Settings window: the main window's agent, `undefined` until the first answer arrives. */
export function useSettingsAgent(): SettingsAgent | undefined {
  const [agent, setAgent] = React.useState<SettingsAgent | undefined>(undefined)
  React.useEffect(() => {
    let disposed = false
    const stop = listen<SettingsAgent>(AGENT, event => {
      if (!disposed) setAgent(event.payload)
    })
    void stop.then(() => {
      if (!disposed) return emitTo("main", REQUEST_AGENT)
    })
    return () => {
      disposed = true
      void stop.then(fn => fn())
    }
  }, [])
  return agent
}

/** Settings window: asks the main window to sign out of Codex. */
async function requestAuth(request: AuthRequest, { listen, emitTo }: SettingsEvents): Promise<void> {
  let resolve!: (result: AuthResult) => void
  const promise = new Promise<AuthResult>(done => {
    resolve = done
  })
  const stop = await listen<AuthResult>(AUTH_RESULT, event => {
    if (event.payload.id === request.id) resolve(event.payload)
  })
  try {
    await emitTo("main", AUTH_REQUEST, request)
    const { error } = await promise
    if (error !== null) throw new Error(error)
  } finally {
    stop()
  }
}

export function createSettingsAuthClient(events: SettingsEvents) {
  return {
    requestSignOut: () => requestAuth({ id: crypto.randomUUID(), action: "logout" }, events),
    requestSignIn: (methodId: string, extra: Record<string, unknown>) =>
      requestAuth({ id: crypto.randomUUID(), action: "login", methodId, extra }, events),
    requestActionResponse: (actionId: string, answer: acp.RequestPermissionResponse | acp.CreateElicitationResponse) =>
      requestAuth({ id: crypto.randomUUID(), action: "respond", actionId, answer }, events)
  }
}

export const { requestSignOut, requestSignIn, requestActionResponse } = createSettingsAuthClient(nativeEvents)
