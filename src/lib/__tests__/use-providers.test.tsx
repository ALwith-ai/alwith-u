import { act, renderHook } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { type ProviderSnapshot, providersPort } from "../providers"
import { useProviders } from "../use-providers"

afterEach(() => {
  vi.restoreAllMocks()
})
function snapshot(revision: number, status: ProviderSnapshot["status"] = "applied"): ProviderSnapshot {
  return {
    revision,
    appliedRevision: status === "applied" ? revision : null,
    providers: {},
    customProviders: [],
    status,
    error: null
  }
}

for (const [eventRevision, readRevision, expectedRevision] of [
  [3, 2, 3],
  [1, 2, 2],
  [2, 2, 2]
] as const) {
  test(`provider read ${readRevision} and event ${eventRevision} preserve the newest configuration`, async () => {
    let receive!: (snapshot: ProviderSnapshot) => void
    let finish!: (value: ProviderSnapshot) => void
    vi.spyOn(providersPort, "onChanged").mockImplementation((listener) => {
      receive = listener
      return Promise.resolve(() => {})
    })
    vi.spyOn(providersPort, "read").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const view = renderHook(useProviders)
    await act(async () => {})
    await act(() => {
      return Promise.try(() => {
        receive(snapshot(eventRevision, "pending"))
      })
    })
    await act(() => {
      return Promise.try(() => {
        finish(snapshot(readRevision))
      })
    })
    expect(view.result.current?.revision).toBe(expectedRevision)
    if (eventRevision === readRevision) expect(view.result.current?.status).toBe("pending")
    await act(() => {
      return Promise.try(() => {
        receive(snapshot(0))
      })
    })
    expect(view.result.current?.revision).toBe(expectedRevision)
    view.unmount()
  })
}
