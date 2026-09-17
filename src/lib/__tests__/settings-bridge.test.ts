import { expect, test } from "bun:test"
import type { Event, EventCallback, EventName } from "@tauri-apps/api/event"
import {
  createSettingsAuthClient,
  serveSettingsBridge,
  type SettingsAgent,
  type SettingsEvents
} from "../settings-bridge"
import { must } from "./must"

function eventBus() {
  const listeners = new Map<string, Set<EventCallback<unknown>>>()
  const messages: { event: string; payload: unknown }[] = []
  const events: SettingsEvents = {
    listen: async <T>(event: EventName, handler: EventCallback<T>) => {
      // Tauri installs listeners asynchronously. Requests must wait for installation.
      await Promise.resolve()
      const bucket = listeners.get(event) ?? new Set()
      bucket.add(handler as EventCallback<unknown>)
      listeners.set(event, bucket)
      return () => {
        bucket.delete(handler as EventCallback<unknown>)
      }
    },
    emitTo: async (_target, event, payload) => {
      messages.push({ event, payload })
      for (const handler of listeners.get(event) ?? []) handler({ event, id: 0, payload } as Event<unknown>)
    }
  }
  return { events, messages, count: (event: string) => listeners.get(event)?.size ?? 0 }
}

const agent: SettingsAgent = { name: "Codex", version: "1", authMethods: [], actions: [] }

test("settings authenticates through main and refreshes the account after login and logout", async () => {
  const bus = eventBus()
  let signedIn = false
  const calls: unknown[] = []
  const stop = serveSettingsBridge(
    {
      agent: () => agent,
      subscribe: () => () => {},
      login: async (method, extra) => {
        calls.push([method, extra])
        signedIn = true
      },
      logout: async () => {
        signedIn = false
      },
      respond: (id, answer) => {
        calls.push([id, answer])
      },
      account: async () => ({
        account: { account: signedIn ? { type: "apiKey" } : null, requiresOpenaiAuth: true },
        rateLimits: null
      }),
      onRateLimits: () => () => {}
    },
    bus.events
  )
  const client = createSettingsAuthClient(bus.events)
  await client.requestSignIn("api-key", { "api-key": { apiKey: "test-only" } })
  expect(calls).toEqual([["api-key", { "api-key": { apiKey: "test-only" } }]])
  expect(bus.messages.findLast(item => item.event === "settings:account")?.payload).toEqual({
    account: { account: { type: "apiKey" }, requiresOpenaiAuth: true },
    rateLimits: null
  })
  await client.requestActionResponse("request-1", { action: "accept" })
  expect(calls[1]).toEqual(["request-1", { action: "accept" }])
  await client.requestSignOut()
  expect(signedIn).toBe(false)
  expect(bus.count("settings:auth-result")).toBe(0)
  stop()
  await Promise.resolve()
  expect(bus.count("settings:auth-request")).toBe(0)
})

test("overlapping requests match their own results and errors release listeners", async () => {
  const bus = eventBus()
  const finish = new Map<string, () => void>()
  const stop = serveSettingsBridge(
    {
      agent: () => agent,
      subscribe: () => () => {},
      logout: async () => {},
      login: method =>
        new Promise<void>((resolve, reject) => {
          finish.set(method, () => (method === "bad" ? reject(new Error("Login rejected")) : resolve()))
        }),
      respond: () => {},
      account: async () => null,
      onRateLimits: () => () => {}
    },
    bus.events
  )
  const client = createSettingsAuthClient(bus.events)
  const first = client.requestSignIn("good", {})
  const second = client.requestSignIn("bad", {})
  const rejected = second.catch((error: unknown) => error)
  // Flush promise work; no timers, processes or actual login.
  for (let index = 0; index < 5; index++) await Promise.resolve()
  must(finish.get("bad"), "the bad login to be pending")()
  expect(await rejected).toEqual(new Error("Login rejected"))
  expect(bus.count("settings:auth-result")).toBe(1)
  must(finish.get("good"), "the good login to be pending")()
  await first
  expect(bus.count("settings:auth-result")).toBe(0)
  stop()
})

test("failed delivery releases the response subscription", async () => {
  const bus = eventBus()
  const client = createSettingsAuthClient({
    ...bus.events,
    emitTo: async () => {
      throw new Error("Main unavailable")
    }
  })
  await expect(client.requestSignOut()).rejects.toThrow("Main unavailable")
  expect(bus.count("settings:auth-result")).toBe(0)
})
