interface ManagedHost {
  bind: (userUuid: string) => Promise<number>
  refresh: (generation: number) => Promise<void>
  clear: () => Promise<void>
}

/** Coalesce account refreshes without letting a previous login's response rejoin the current one. */
export function createManagedProviders(host: ManagedHost) {
  let revision = 0
  let pending: { user: string; work: Promise<void> } | undefined
  let clearing: Promise<void> = Promise.resolve()
  function current(expected: number): void {
    if (revision !== expected) throw new Error("ALwith account changed during provider refresh")
  }
  return {
    refresh(user: string): Promise<void> {
      if (pending?.user === user) return pending.work
      const expected = ++revision
      const work = (async () => {
        await clearing
        current(expected)
        const generation = await host.bind(user)
        current(expected)
        await host.refresh(generation)
        current(expected)
      })()
      pending = { user, work }
      void work
        .finally(() => {
          if (pending?.work === work) pending = undefined
        })
        .catch(() => {})
      return work
    },
    clear(): Promise<void> {
      revision++
      pending = undefined
      // Native invalidation must start immediately, not wait for a fetch it invalidates.
      clearing = host.clear()
      return clearing
    }
  }
}

/** Serialize complete login/logout writes, including their asynchronous token storage. */
export function createAccountTransition(): (operation: () => Promise<void>) => Promise<void> {
  let pending: Promise<void> = Promise.resolve()
  return (operation) => {
    const work = pending.then(operation, operation)
    pending = work.catch(() => {})
    return work
  }
}
