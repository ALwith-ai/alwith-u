/**
 * One ordered operation lane per session.
 *
 * open / close / delete run in submission order; a session runs one operation at a time. Only
 * adjacent equivalent opens (same fingerprint, nothing queued between them) merge: the second
 * caller awaits the same replay instead of sending the agent another one (dsh
 * `ApiSessionAgentController.resumes`). close / delete are revocation boundaries: everything still
 * queued before them is cancelled (AbortError), the running operation finishes first, and an open
 * submitted after the boundary is a new explicit operation that waits for it.
 */
type OperationKind = "open" | "close" | "delete"

interface Operation {
  kind: OperationKind
  fingerprint: string | null
  run: () => Promise<unknown>
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  cancelled: boolean
}

interface Lane {
  running: Operation | null
  queued: Operation[]
}

export class SessionOperations {
  private readonly lanes = new Map<string, Lane>()

  /** Merges with an adjacent open of the same fingerprint, otherwise queues. */
  open<T>(sessionId: string, fingerprint: string, run: () => Promise<T>): Promise<T> {
    const lane = this.lane(sessionId)
    const last = lane.queued.length > 0 ? lane.queued[lane.queued.length - 1] : lane.running
    if (last && last.kind === "open" && last.fingerprint === fingerprint && !last.cancelled) {
      return last.promise as Promise<T>
    }
    return this.enqueue(lane, "open", fingerprint, run)
  }

  /** Revocation boundary: cancels everything still queued, then runs after the current operation. */
  close<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    return this.revokeAndEnqueue(sessionId, "close", run)
  }

  delete<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    return this.revokeAndEnqueue(sessionId, "delete", run)
  }

  /** Operations not yet started (for tests). */
  pending(sessionId: string): number {
    return this.lanes.get(sessionId)?.queued.length ?? 0
  }

  private revokeAndEnqueue<T>(sessionId: string, kind: OperationKind, run: () => Promise<T>): Promise<T> {
    const lane = this.lane(sessionId)
    for (const operation of lane.queued) {
      operation.cancelled = true
      operation.reject(new DOMException(`Session ${kind} revoked the queued ${operation.kind}`, "AbortError"))
    }
    lane.queued.length = 0
    return this.enqueue(lane, kind, null, run)
  }

  private enqueue<T>(lane: Lane, kind: OperationKind, fingerprint: string | null, run: () => Promise<T>): Promise<T> {
    let resolve!: (value: unknown) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    const operation: Operation = { kind, fingerprint, run, promise, resolve, reject, cancelled: false }
    lane.queued.push(operation)
    this.advance(lane)
    return promise as Promise<T>
  }

  private advance(lane: Lane): void {
    if (lane.running) return
    const next = lane.queued.shift()
    if (!next) return
    lane.running = next
    next.run().then(next.resolve, next.reject)
    void next.promise.then(
      () => this.settle(lane, next),
      () => this.settle(lane, next)
    )
  }

  private settle(lane: Lane, operation: Operation): void {
    if (lane.running === operation) lane.running = null
    this.advance(lane)
  }

  private lane(sessionId: string): Lane {
    let lane = this.lanes.get(sessionId)
    if (!lane) {
      lane = { running: null, queued: [] }
      this.lanes.set(sessionId, lane)
    }
    return lane
  }
}
