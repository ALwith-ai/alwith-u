import { createInterface } from "node:readline"

import { ContentCache } from "./cache"
import { NativeHistory, object, string } from "./native"
import { HistoryPages } from "./pages"

const native = new NativeHistory(string(process.env.ALWITH_HISTORY_CODEX))
const cache = new ContentCache()
const pages = new HistoryPages(native, cache)
const requests = new Map<unknown, AbortController>()
let queue = Promise.resolve()
let outstanding = 0
let initialized = false
const cleaner = setInterval(() => {
  cache.prune()
  pages.prune()
}, 60_000)
cleaner.unref()

async function receive(line: string): Promise<void> {
  let id: unknown
  try {
    const frame = object(JSON.parse(line))
    id = frame.id
    const params = object(frame.params ?? {})
    if (frame.method === "$/cancel_request") {
      requests.get(params.requestId)?.abort()
      return
    }
    if (id == null) return
    let result: unknown
    if (frame.method === "initialize") {
      if (params.protocolVersion !== 2) throw new Error("Unsupported ACP version")
      initialized = true
      result = {
        protocolVersion: 2,
        info: { name: "alwith-mobile-history", version: "1" },
        capabilities: { _meta: { mobileHistory: 1 } },
        authMethods: []
      }
    } else if (!initialized) throw new Error("History worker is not initialized")
    else if (frame.method === "_alwith/mobile_history_content") {
      result = cache.read(
        string(params.sessionId),
        string(params.contentId),
        Number(params.offset),
        Number(params.maxBytes)
      )
    } else if (frame.method === "_alwith/mobile_history_page") {
      if (outstanding >= 16) throw new Error("History reader queue is full")
      const controller = new AbortController()
      requests.set(id, controller)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)])
      outstanding++
      const read = queue.then(async () => {
        signal.throwIfAborted()
        return pages.read(
          string(params.sessionId),
          params.cursor,
          Number(params.maxBytes),
          AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        )
      })
      queue = read.then(
        () => {
          outstanding--
        },
        () => {
          outstanding--
        }
      )
      let abort: (() => void) | undefined
      try {
        result = await Promise.race([
          read,
          new Promise<never>((_, reject) => {
            abort = () => reject(new Error("History read cancelled or timed out"))
            signal.addEventListener("abort", abort, { once: true })
            if (signal.aborted) abort()
          })
        ])
      } finally {
        if (abort) signal.removeEventListener("abort", abort)
        requests.delete(id)
      }
    } else throw new Error("Unsupported history worker method")
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
  } catch (error) {
    if (id != null)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) }
        }) + "\n"
      )
  }
}

const input = createInterface({ input: process.stdin })
input.on("line", (line) => {
  void receive(line)
})
function close(): void {
  for (const controller of requests.values()) controller.abort()
  native.close()
  cache.close()
  clearInterval(cleaner)
  input.close()
}
process.on("SIGTERM", close)
process.on("SIGINT", close)
input.once("close", close)
