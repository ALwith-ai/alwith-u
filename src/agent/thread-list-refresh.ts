import type { CodexClient } from "./client"

/** Coalesce Runtime state transitions; streaming task updates do not invalidate the list. */
export function watchThreadList(client: CodexClient): () => void {
  let disposed = false
  let pending = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    pending = true
    if (running || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void refresh()
    }, 300)
  }
  const refresh = async () => {
    pending = false
    running = true
    try {
      await client.listThreads({ reset: true })
    } catch {
      // The shared list exposes errors and retains the previous successful snapshot.
    } finally {
      running = false
      if (!disposed && pending) schedule()
    }
  }
  const stop = client.store.subscribe((state, previous) => {
    if (state.runStates === previous.runStates) return
    const ids = new Set([...Object.keys(state.runStates), ...Object.keys(previous.runStates)])
    if (
      [...ids].some(id => {
        const before = previous.runStates[id]
        const after = state.runStates[id]
        return (
          before?.state !== after?.state ||
          before?.reusableDraft !== after?.reusableDraft ||
          before?.cwd !== after?.cwd ||
          before?.title !== after?.title
        )
      })
    )
      schedule()
  })
  void refresh()
  return () => {
    disposed = true
    stop()
    clearTimeout(timer)
  }
}
