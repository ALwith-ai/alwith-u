import { isTauri } from "@tauri-apps/api/core"
import { info } from "@tauri-apps/plugin-log"

export function traceCatalog(message: string): void {
  if (import.meta.env.MODE === "development" && isTauri()) void info(`[plugins] ${message}`).catch(console.error)
}

/** Successful values and in-flight reads share a key; failed reads remain retryable. */
export class RequestCache<T> {
  private readonly label: string

  constructor(label: string) {
    this.label = label
  }

  private entries = new Map<string, { value?: T; pending?: Promise<T> }>()

  peek(key: string): T | undefined {
    return this.entries.get(key)?.value
  }

  pending(key: string): boolean {
    return this.entries.get(key)?.pending !== undefined
  }

  clear(): void {
    this.entries.clear()
  }

  read(key: string, load: () => Promise<T>, refresh = false): Promise<T> {
    const started = performance.now()
    const measure = (source: "cache" | "request") => {
      if (import.meta.env.MODE !== "development") return
      const elapsed = performance.now() - started
      performance.measure(this.label, { start: started, detail: { source } })
      if (isTauri())
        void info(`[plugins] resource=${this.label} source=${source} elapsed_ms=${elapsed.toFixed(2)}`).catch(
          console.error
        )
    }
    const previous = this.entries.get(key)
    if (previous?.pending) return previous.pending
    if (!refresh && previous?.value !== undefined) {
      measure("cache")
      return Promise.resolve(previous.value)
    }
    traceCatalog(`resource=${this.label} source=request phase=started`)
    const entry = { value: previous?.value, pending: undefined as Promise<T> | undefined }
    const pending = Promise.try(load).then(
      (value) => {
        measure("request")
        entry.value = value
        entry.pending = undefined
        return value
      },
      (error: unknown) => {
        entry.pending = undefined
        throw error
      }
    )
    entry.pending = pending
    this.entries.set(key, entry)
    return pending
  }
}

export const skillDocuments = new RequestCache<string>("plugins.skillDocument")
