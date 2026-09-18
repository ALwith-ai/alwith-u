import { act, renderHook } from "@testing-library/react"
import { afterEach, expect, spyOn, test } from "bun:test"
import * as events from "@tauri-apps/api/event"
import * as providers from "../providers"
import type { ProviderSnapshot } from "../providers"
import { useProviders } from "../use-providers"
import { installDom } from "../../features/chat/codex/__tests__/dom-environment"

installDom()
afterEach(() => {
  providersRead?.mockRestore()
  eventListen?.mockRestore()
})
let providersRead: ReturnType<typeof spyOn> | undefined
let eventListen: ReturnType<typeof spyOn> | undefined
function snapshot(revision: number, status: ProviderSnapshot["status"] = "applied"): ProviderSnapshot {
  return { revision, appliedRevision: status === "applied" ? revision : null, providers: {}, status, error: null }
}

for (const [eventRevision, readRevision, expectedRevision] of [
  [3, 2, 3],
  [1, 2, 2],
  [2, 2, 2]
] as const) {
  test(`provider read ${readRevision} and event ${eventRevision} preserve the newest configuration`, async () => {
    let receive!: (event: events.Event<ProviderSnapshot>) => void
    let finish!: (value: ProviderSnapshot) => void
    eventListen = spyOn(events, "listen").mockImplementation(async (_event, callback) => {
      receive = callback as typeof receive
      return () => {}
    })
    providersRead = spyOn(providers, "loadProviders").mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const view = renderHook(useProviders)
    await act(async () => {})
    await act(async () => {
      receive({ event: providers.PROVIDERS_CHANGED, id: 1, payload: snapshot(eventRevision, "pending") })
    })
    await act(async () => {
      finish(snapshot(readRevision))
    })
    expect(view.result.current?.revision).toBe(expectedRevision)
    if (eventRevision === readRevision) expect(view.result.current?.status).toBe("pending")
    await act(async () => {
      receive({ event: providers.PROVIDERS_CHANGED, id: 2, payload: snapshot(0) })
    })
    expect(view.result.current?.revision).toBe(expectedRevision)
    view.unmount()
  })
}
