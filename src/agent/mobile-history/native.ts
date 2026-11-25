import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"

type NativeMethod = "initialize" | "thread/turns/list" | "thread/items/list" | "thread/items/read"
export type ObjectValue = Record<string, unknown>

export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid history object")
  return value as ObjectValue
}

export function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Invalid history identity")
  return value
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid history array")
  return value
}

export class NativeError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export class NativeBudgetError extends Error {}

const MAX_BYTES = 64 * 1024 * 1024

export class NativeHistory {
  private child: ChildProcessWithoutNullStreams | undefined
  private seq = 0
  private pending?: { id: number; resolve: (result: unknown) => void; reject: (error: Error) => void }

  private readonly binary: string
  constructor(binary: string) {
    this.binary = binary
  }

  async read(
    method: Exclude<NativeMethod, "initialize">,
    params: ObjectValue,
    signal: AbortSignal
  ): Promise<ObjectValue> {
    signal.throwIfAborted()
    if (!this.child) {
      const child = spawn(this.binary, ["app-server"], { stdio: "pipe", windowsHide: true })
      this.child = child
      // Drain stderr without sending private session diagnostics to the phone.
      child.stderr.resume()
      child.stdin.on("error", (error) => this.fail(child, error))
      child.once("error", (error) => this.fail(child, error))
      child.once("exit", () => this.fail(child, new Error("History reader exited")))
      void this.consume(child).catch((error: Error) => this.fail(child, error))
      await this.request(
        "initialize",
        { clientInfo: { name: "alwith-mobile-history", version: "1" }, capabilities: { experimentalApi: true } },
        signal
      )
      child.stdin.write('{"method":"initialized","params":{}}\n')
    }
    return object(await this.request(method, params, signal))
  }

  private async consume(child: ChildProcessWithoutNullStreams): Promise<void> {
    let parts: Buffer[] = []
    let length = 0
    for await (const chunk of child.stdout) {
      const bytes = Buffer.from(chunk)
      let start = 0
      while (start < bytes.length) {
        const stop = bytes.indexOf(10, start)
        const part = bytes.subarray(start, stop < 0 ? bytes.length : stop)
        length += part.length
        if (length > MAX_BYTES) throw new NativeBudgetError("Native history response exceeds 64 MiB")
        parts.push(part)
        if (stop < 0) break
        const frame = object(JSON.parse(Buffer.concat(parts, length).toString("utf8")))
        parts = []
        length = 0
        const pending = this.pending
        if (this.child === child && pending && frame.id === pending.id && !frame.method) {
          this.pending = undefined
          if (frame.error) {
            const error = object(frame.error)
            pending.reject(new NativeError(Number(error.code), String(error.message)))
          } else pending.resolve(frame.result)
        }
        start = stop + 1
      }
    }
    this.fail(child, new Error("Native history stream closed"))
  }

  private async request(method: NativeMethod, params: ObjectValue, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const child = this.child
    if (!child || this.pending) throw new Error("History reader unavailable")
    const id = ++this.seq
    const abort = () => this.fail(child, new Error("History read cancelled or timed out"))
    signal.addEventListener("abort", abort, { once: true })
    try {
      return await new Promise((resolve, reject) => {
        this.pending = { id, resolve, reject }
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n")
      })
    } finally {
      signal.removeEventListener("abort", abort)
    }
  }

  private fail(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) return
    this.child = undefined
    const pending = this.pending
    this.pending = undefined
    pending?.reject(error)
    child.stdin.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }

  close(): void {
    if (this.child) this.fail(this.child, new Error("History service stopped"))
  }
}
