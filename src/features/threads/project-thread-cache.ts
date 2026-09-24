import { createStore } from "zustand/vanilla"
import type { ThreadSummary } from "@/agent/client"

type ProjectResult =
  { status: "loading" } | { status: "failed"; error: string } | { status: "ready"; threads: ThreadSummary[] }

/** Disposable query results, never a second source of conversation history. */
export class ProjectThreadCache {
  readonly store = createStore<Record<string, ProjectResult>>()(() => ({}))

  private readonly query: (cwd: string) => Promise<ThreadSummary[]>

  constructor(query: (cwd: string) => Promise<ThreadSummary[]>) {
    this.query = query
  }

  load(cwd: string): void {
    if (this.store.getState()[cwd] !== undefined) return
    const loading: ProjectResult = { status: "loading" }
    this.store.setState(state => ({ ...state, [cwd]: loading }), true)
    void this.query(cwd).then(
      threads => {
        if (this.store.getState()[cwd] !== loading) return
        this.store.setState(
          state => ({
            ...state,
            [cwd]: {
              status: "ready",
              threads: [...threads].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
            }
          }),
          true
        )
      },
      (error: unknown) => {
        if (this.store.getState()[cwd] !== loading) return
        this.store.setState(
          state => ({
            ...state,
            [cwd]: { status: "failed", error: error instanceof Error ? error.message : String(error) }
          }),
          true
        )
      }
    )
  }

  invalidate(cwds: Iterable<string> = Object.keys(this.store.getState())): void {
    const next = { ...this.store.getState() }
    let changed = false
    for (const cwd of cwds) {
      if (next[cwd] === undefined) continue
      delete next[cwd]
      changed = true
    }
    if (changed) this.store.setState(next, true)
  }

  synchronize(previous: ThreadSummary[], current: ThreadSummary[]): void {
    const before = new Map(previous.map(thread => [thread.sessionId, thread]))
    const after = new Map(current.map(thread => [thread.sessionId, thread]))
    const changed = new Set<string>()
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const left = before.get(id)
      const right = after.get(id)
      if (
        left?.cwd === right?.cwd &&
        left?.title === right?.title &&
        left?.updatedAt === right?.updatedAt &&
        left?.archived === right?.archived
      )
        continue
      if (left !== undefined) changed.add(left.cwd)
      if (right !== undefined) changed.add(right.cwd)
    }
    // A mutation can target a thread outside the sidebar's loaded pages.
    this.invalidate(changed.size === 0 ? undefined : changed)
  }
}
