import type { ExtensionRuntime } from "@alwith/module-extension/host"

export interface UninstallFailures {
  error(id: string): string | undefined
  subscribe(listener: () => void): () => void
}

interface Failure {
  id: string
  error: string
}
interface FailureEvents {
  listen(listener: (failure: Failure) => void): Promise<() => void>
  emit(failure: Failure): Promise<void>
  report(error: unknown): void
}

/** Release errors belong to individual WebViews; share them without granting cleanup authority. */
export async function watchUninstallFailures(
  runtime: Pick<ExtensionRuntime, "snapshot" | "subscribe">,
  events: FailureEvents
): Promise<UninstallFailures & { dispose(): void }> {
  const failures = new Map<string, string>()
  const previous = new Map<string, string>()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  const unlisten = await events.listen(failure => {
    if (runtime.snapshot().native?.pending.some(item => item.id === failure.id && item.action === "uninstall")) {
      failures.set(failure.id, failure.error)
      notify()
    }
  })
  const inspect = (): void => {
    const state = runtime.snapshot()
    for (const id of failures.keys())
      if (!state.native?.pending.some(item => item.id === id && item.action === "uninstall")) failures.delete(id)
    for (const [id, error] of Object.entries(state.errors)) {
      if (
        error &&
        error !== previous.get(id) &&
        state.native?.pending.some(item => item.id === id && item.action === "uninstall")
      )
        void events.emit({ id, error }).catch(events.report)
    }
    previous.clear()
    for (const [id, error] of Object.entries(state.errors)) previous.set(id, error)
  }
  const unsubscribe = runtime.subscribe(inspect)
  inspect()
  return {
    error: id => failures.get(id),
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      unsubscribe()
      unlisten()
      listeners.clear()
    }
  }
}
