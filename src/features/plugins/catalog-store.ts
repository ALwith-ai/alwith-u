import { createStore, type Store } from "@alwith/api/client"

import { PluginAccountChangedError } from "./marketplace"
import type { PluginCatalogApi, PluginCatalogEntry, PluginCatalogPage } from "./marketplace"
export type { PluginCatalogApi } from "./marketplace"

export type PluginCatalogState = {
  query: string | null
  scope: string
  entries: PluginCatalogEntry[]
  nextCursor: string | null
  loading: boolean
  error: string | null
  revision: number
  load: (query: string, cwds: string[]) => Promise<void>
  loadMore: () => Promise<void>
  retry: () => Promise<void>
  clear: () => void
}

type Catalog = { accountId: string | null; query: string; cwds: string[]; pages: PluginCatalogPage[] }

/** Cursor state for U-owned HTTP requests; credentials never enter this store. */
export function createPluginCatalogStore(api: PluginCatalogApi): Store<PluginCatalogState> {
  const catalogs = new Map<string, Catalog>()
  let selected: Catalog | null = null
  let generation = 0
  let pending: Promise<void> | null = null
  let controller: AbortController | null = null
  const store: Store<PluginCatalogState> = createStore<PluginCatalogState>({
    query: null,
    scope: "[]",
    entries: [],
    nextCursor: null,
    loading: false,
    error: null,
    revision: 0,
    load: async (query, cwds) => {
      const scope = JSON.stringify([...new Set(cwds)].toSorted())
      if (pending && store.getState().query === query && store.getState().scope === scope) {
        await pending
        return
      }
      controller?.abort()
      const revision = ++generation
      pending = null
      selected = null
      store.setState({ query, scope, entries: [], nextCursor: null, loading: true, error: null })
      try {
        const identity = await api.identity()
        if (revision !== generation) return
        const key = JSON.stringify([identity, scope, query])
        selected = catalogs.get(key) ?? { accountId: identity, query, cwds: JSON.parse(scope) as string[], pages: [] }
        catalogs.delete(key)
        catalogs.set(key, selected)
        if (catalogs.size > 8) catalogs.delete(catalogs.keys().next().value!)
        if (selected.pages.length) {
          project(selected)
          store.setState({ loading: false })
        } else await read()
      } catch (error) {
        if (revision === generation)
          store.setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
    loadMore: () => {
      if (store.getState().error || !selected || (selected.pages.length && store.getState().nextCursor === null))
        return Promise.resolve()
      return read()
    },
    retry: () =>
      selected
        ? read()
        : store.getState().load(store.getState().query ?? "", JSON.parse(store.getState().scope) as string[]),
    clear: () => {
      controller?.abort()
      generation++
      selected = null
      pending = null
      catalogs.clear()
      store.setState({
        query: null,
        scope: "[]",
        entries: [],
        nextCursor: null,
        loading: false,
        error: null,
        revision: store.getState().revision + 1
      })
    }
  })

  function project(catalog: Catalog) {
    const unique = new Map<string, PluginCatalogEntry>()
    for (const page of catalog.pages)
      for (const entry of page.data)
        unique.set(
          JSON.stringify([
            entry.marketplaceName,
            entry.marketplacePath,
            entry.plugin.remotePluginId ?? entry.plugin.id
          ]),
          entry
        )
    store.setState({ entries: [...unique.values()], nextCursor: catalog.pages.at(-1)?.nextCursor ?? null })
  }

  function read(): Promise<void> {
    if (pending) return pending
    const catalog = selected
    if (!catalog) return Promise.resolve()
    controller = new AbortController()
    const signal = controller.signal
    const revision = generation
    const current = () => revision === generation && catalog === selected
    const cursor = catalog.pages.at(-1)?.nextCursor ?? null
    if (catalog.pages.length && cursor === null) return Promise.resolve()
    store.setState({ loading: true, error: null })
    // Defer invocation so reentrant callers observe the same in-flight request.
    const task = Promise.resolve().then(async () => {
      try {
        const response = await (catalog.query === ""
          ? api.catalogPlugins({ cursor, limit: 50, signal, accountId: catalog.accountId })
          : api.searchPlugins({ searchTerm: catalog.query, cursor, limit: 50, signal, accountId: catalog.accountId }))
        if (!current()) return
        const used = new Set(catalog.pages.map((page) => page.nextCursor))
        if (response.nextCursor !== null && (response.nextCursor === cursor || used.has(response.nextCursor)))
          throw new Error("Plugin catalog cursor made no progress")
        catalog.pages.push(response)
        project(catalog)
      } catch (error) {
        if (current()) {
          if (error instanceof PluginAccountChangedError) {
            catalogs.clear()
            selected = null
            store.setState({ entries: [], nextCursor: null })
          }
          store.setState({ error: error instanceof Error ? error.message : String(error) })
        }
      } finally {
        if (revision === generation) {
          pending = null
          store.setState({ loading: false })
        }
      }
    })
    pending = task
    return task
  }
  return store
}
