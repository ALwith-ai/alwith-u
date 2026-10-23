/**
 * Per-session lifecycle lanes. Adjacent equivalent opens share their result.
 * Revocation cancels queued operations and signals the running open, but waits
 * for the peer response before closing so late acceptance cannot outlive close.
 * An explicit reopen queues after that boundary; other sessions are independent.
 */
type OperationKind = "open" | "close" | "delete"

interface Operation {
  kind: OperationKind
  fingerprint: string | null
  run: (signal: AbortSignal) => Promise<unknown>
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  cancelled: boolean
  controller: AbortController
}

interface Lane {
  running: Operation | null
  queued: Operation[]
}

export class SessionOperations {
  private readonly lanes = new Map<string, Lane>()

  /** Merges with an adjacent open of the same fingerprint, otherwise queues. */
  open<T>(sessionId: string, fingerprint: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const lane = this.lane(sessionId)
    const last = lane.queued.at(-1) ?? lane.running
    if (last?.kind === "open" && last.fingerprint === fingerprint && !last.cancelled) {
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

  busy(sessionId: string): boolean {
    const lane = this.lanes.get(sessionId)
    return !!lane && (lane.running !== null || lane.queued.length > 0)
  }

  /** Operations not yet started (for tests). */
  pending(sessionId: string): number {
    return this.lanes.get(sessionId)?.queued.length ?? 0
  }

  private revokeAndEnqueue<T>(sessionId: string, kind: OperationKind, run: () => Promise<T>): Promise<T> {
    const lane = this.lane(sessionId)
    // Cancellation is cooperative: retain the lane until the peer settles the request.
    if (lane.running?.kind === "open") {
      lane.running.cancelled = true
      lane.running.controller.abort(new DOMException(`Session ${kind} revoked the running open`, "AbortError"))
    }
    for (const operation of lane.queued) {
      operation.cancelled = true
      operation.reject(new DOMException(`Session ${kind} revoked the queued ${operation.kind}`, "AbortError"))
    }
    lane.queued.length = 0
    return this.enqueue(lane, kind, null, run)
  }

  private enqueue<T>(
    lane: Lane,
    kind: OperationKind,
    fingerprint: string | null,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    let resolve!: (value: unknown) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    const operation: Operation = {
      kind, fingerprint, run, promise, resolve, reject,
      cancelled: false,
      controller: new AbortController()
    }
    lane.queued.push(operation)
    this.advance(lane)
    return promise as Promise<T>
  }

  private advance(lane: Lane): void {
    if (lane.running) return
    const next = lane.queued.shift()
    if (!next) return
    lane.running = next
    Promise.try(() => next.run(next.controller.signal)).then(next.resolve, next.reject)
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
