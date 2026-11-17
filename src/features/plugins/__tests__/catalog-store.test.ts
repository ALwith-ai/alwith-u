import type { PluginSummary } from "@alwith/module-chat/client"
import { expect, test } from "vitest"

import { createPluginCatalogStore as createStore } from "../catalog-store"
import type { PluginCatalogApi, PluginCatalogPage as PluginSearchResponse } from "../marketplace"
function createPluginCatalogStore(api: Omit<PluginCatalogApi, "identity">) {
  return createStore({ ...api, identity: async () => "account" })
}

function page(ids: string[], nextCursor: string | null): PluginSearchResponse {
  return {
    data: ids.map((id) => ({
      plugin: { id, remotePluginId: id } as PluginSummary,
      marketplaceName: "remote",
      marketplacePath: null
    })),
    nextCursor
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("loads one page, deduplicates appended entries and reuses a visited query", async () => {
  const requests: unknown[] = []
  const api: Omit<PluginCatalogApi, "identity"> = {
    catalogPlugins: async (params) => {
      requests.push(params)
      return params?.cursor ? page(["one", "two"], null) : page(["one"], "next")
    },
    searchPlugins: async () => page(["semantic"], null)
  }
  const store = createPluginCatalogStore(api)
  await store.getState().load("", ["/a"])
  expect(requests).toEqual([expect.objectContaining({ cursor: null, limit: 50 })])
  await store.getState().loadMore()
  expect(store.getState().entries.map((entry) => entry.plugin.id)).toEqual(["one", "two"])
  await store.getState().load("mail", ["/a"])
  expect(store.getState().entries[0]?.plugin.id).toBe("semantic")
  await store.getState().load("", ["/a"])
  expect(requests).toHaveLength(2)
  expect(store.getState().entries).toHaveLength(2)
  await store.getState().loadMore()
  expect(requests).toHaveLength(2)
})

test("concurrent scrolls share a request and a failed page retries its cursor", async () => {
  const second = deferred<PluginSearchResponse>()
  let calls = 0
  const cursors: (string | null | undefined)[] = []
  const store = createPluginCatalogStore({
    catalogPlugins: async (params) => {
      cursors.push(params?.cursor)
      if (++calls === 1) return page(["one"], "next")
      if (calls === 2) return second.promise
      return page(["two"], null)
    },
    searchPlugins: async () => page([], null)
  })
  await store.getState().load("", [])
  const a = store.getState().loadMore()
  const b = store.getState().loadMore()
  second.resolve(page([], "next"))
  await Promise.all([a, b])
  expect(calls).toBe(2)
  expect(store.getState().error).toContain("no progress")
  expect(store.getState().entries).toHaveLength(1)
  await store.getState().retry()
  expect(cursors).toEqual([null, "next", "next"])
  expect(store.getState().entries).toHaveLength(2)
  expect(store.getState().error).toBeNull()
})

test("late results cannot overwrite a new query, scope or invalidation", async () => {
  for (const change of ["query", "scope", "clear"] as const) {
    const old = deferred<PluginSearchResponse>()
    const store = createPluginCatalogStore({
      catalogPlugins: async () => page([], null),
      searchPlugins: async ({ searchTerm }) => (searchTerm === "old" ? old.promise : page(["new"], null))
    })
    const pending = store.getState().load("old", ["/a"])
    await Promise.resolve()
    if (change === "clear") store.getState().clear()
    else await store.getState().load("new", [change === "scope" ? "/b" : "/a"])
    old.resolve(page(["stale"], null))
    await pending
    expect(store.getState().entries.map((entry) => entry.plugin.id)).toEqual(change === "clear" ? [] : ["new"])
  }
})

test("errors preserve loaded entries and queries pass their cursor and project scope unchanged", async () => {
  const requests: unknown[] = []
  let fail = true
  const store = createPluginCatalogStore({
    catalogPlugins: async () => page([], null),
    searchPlugins: async (params) => {
      requests.push(params)
      if (params.cursor && fail) {
        fail = false
        throw new Error("Unavailable")
      }
      return page([params.cursor ? "second" : "semantic"], params.cursor ? null : "next")
    }
  })
  await store.getState().load("MAIL", ["/b", "/a", "/a"])
  await store.getState().loadMore()
  expect(store.getState().entries[0]?.plugin.id).toBe("semantic")
  expect(store.getState().error).toBe("Unavailable")
  await store.getState().retry()
  expect(requests).toEqual([
    { searchTerm: "MAIL", accountId: "account", signal: expect.any(AbortSignal), cursor: null, limit: 50 },
    { searchTerm: "MAIL", accountId: "account", signal: expect.any(AbortSignal), cursor: "next", limit: 50 },
    { searchTerm: "MAIL", accountId: "account", signal: expect.any(AbortSignal), cursor: "next", limit: 50 }
  ])
})

test("query changes abort the old HTTP request and account changes do not reuse cached pages", async () => {
  let identity = "first"
  let firstSignal: AbortSignal | undefined
  const old = deferred<PluginSearchResponse>()
  const store = createStore({
    identity: async () => identity,
    catalogPlugins: async () => page([identity], null),
    searchPlugins: async ({ searchTerm, signal }) => {
      if (searchTerm === "old") {
        firstSignal = signal
        return old.promise
      }
      return page([searchTerm], null)
    }
  })
  const pending = store.getState().load("old", [])
  await Promise.resolve()
  await Promise.resolve()
  await store.getState().load("new", [])
  expect(firstSignal?.aborted).toBe(true)
  old.resolve(page(["stale"], null))
  await pending
  expect(store.getState().entries[0]?.plugin.id).toBe("new")
  await store.getState().load("", [])
  expect(store.getState().entries[0]?.plugin.id).toBe("first")
  identity = "second"
  await store.getState().load("", [])
  expect(store.getState().entries[0]?.plugin.id).toBe("second")
})

test("identity failures remain retryable and credentials never enter catalog state", async () => {
  let fail = true
  const store = createStore({
    identity: async () => {
      if (fail) {
        fail = false
        throw new Error("Login unavailable")
      }
      return "account"
    },
    catalogPlugins: async () => page(["one"], null),
    searchPlugins: async () => page([], null)
  })
  await store.getState().load("", [])
  expect(store.getState().error).toBe("Login unavailable")
  await store.getState().retry()
  expect(store.getState().entries[0]?.plugin.id).toBe("one")
  expect(store.getState().error).toBeNull()
  expect(JSON.stringify(store.getState())).not.toMatch(/accessToken|Authorization/)
})

test("a changed account clears old rows before retrying its first page", async () => {
  const { PluginAccountChangedError } = await import("../marketplace")
  let identity = "first"
  const store = createStore({
    identity: async () => identity,
    catalogPlugins: async ({ cursor } = {}) => {
      if (cursor) {
        identity = "second"
        throw new PluginAccountChangedError("Account changed")
      }
      return page([identity], identity === "first" ? "next" : null)
    },
    searchPlugins: async () => page([], null)
  })
  await store.getState().load("", [])
  await store.getState().loadMore()
  expect(store.getState()).toMatchObject({ entries: [], loading: false, error: "Account changed" })
  await store.getState().retry()
  expect(store.getState().entries[0]?.plugin.id).toBe("second")
})
