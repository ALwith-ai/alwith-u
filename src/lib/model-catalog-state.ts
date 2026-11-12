type CatalogSourceState<T> =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: T | null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: T | null; error: unknown }

export interface CatalogSource<T> {
  getSnapshot(): CatalogSourceState<T>
  subscribe(listener: () => void): () => void
  reset(account: object | null): void
  refresh(loader: () => Promise<T>): Promise<void>
  update(value: T): void
}

export class CatalogAccountChangedError extends Error {
  constructor() {
    super("Catalog account changed")
    this.name = "CatalogAccountChangedError"
  }
}

export function createCatalogSource<T>(): CatalogSource<T> {
  let state: CatalogSourceState<T> = { status: "idle", data: null, error: null }
  let account: object | null = null
  let epoch = 0
  let revision = 0
  const listeners = new Set<() => void>()
  function publish(next: CatalogSourceState<T>): void {
    state = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset: (nextAccount) => {
      account = nextAccount
      ++epoch
      ++revision
      publish({ status: "idle", data: null, error: null })
    },
    refresh: async (loader) => {
      const requestAccount = account
      const requestEpoch = epoch
      const requestRevision = ++revision
      publish({ status: "loading", data: state.data, error: null })
      let data: T
      try {
        data = await loader()
      } catch (error) {
        if (requestAccount !== account || requestEpoch !== epoch) throw new CatalogAccountChangedError()
        if (requestRevision === revision) publish({ status: "error", data: state.data, error })
        throw error
      }
      if (requestAccount !== account || requestEpoch !== epoch) throw new CatalogAccountChangedError()
      if (requestRevision === revision) publish({ status: "ready", data, error: null })
    },
    update: (data) => {
      ++revision
      publish({ status: "ready", data, error: null })
    }
  }
}
