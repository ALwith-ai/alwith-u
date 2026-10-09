/**
 * Shared test setup. Browser-only stubs apply when the project runs under jsdom;
 * the engine project (node environment) only gets the matcher extension.
 */
import * as matchers from "@testing-library/jest-dom/matchers"
import { expect, vi } from "vitest"

// Extend the Vitest instance of this worker explicitly; under Bun the jest-dom/vitest entry can
// resolve to a different instance.
expect.extend(matchers)

// Bun's Node runtime exposes a localStorage accessor without a backing file: the property exists
// but reads as undefined, and zustand persist captures it at module init. Provide standard Storage.
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    const value = this.values.get(key)
    return value === undefined ? null : value
  }

  key(index: number): string | null {
    const value = [...this.values.keys()][index]
    return value === undefined ? null : value
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: new MemoryStorage() })

if (typeof document !== "undefined") {
  const { ChatWorkerStub } = await import("@/features/chat/codex/__tests__/chat-worker-stub")
  // jsdom has no matchMedia or Web Animations; components only need the API surface.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false
      }
    })) as unknown as typeof window.matchMedia
  }
  if (typeof Element.prototype.getAnimations !== "function") Element.prototype.getAnimations = () => []
  if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => {}
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = function scrollTo(this: Element, x?: number | ScrollToOptions, y?: number) {
      if (typeof x === "object") {
        if (x.left !== undefined) this.scrollLeft = x.left
        if (x.top !== undefined) this.scrollTop = x.top
        return
      }
      if (x !== undefined) this.scrollLeft = x
      if (y !== undefined) this.scrollTop = y
    }
  }
  // The jsdom window brings its own typed arrays, so `encode() instanceof Uint8Array` is false for
  // Node's TextEncoder. Product code checks bytes with instanceof; keep Node's constructors global.
  const { Buffer } = await import("node:buffer")
  globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor as Uint8ArrayConstructor
  globalThis.ArrayBuffer = Buffer.alloc(0).buffer.constructor as ArrayBufferConstructor
  // jsdom's FileReader rejects the Node Blobs that fetch responses produce; read any blob-like
  // value through its own methods instead.
  globalThis.FileReader = class NodeFileReader extends EventTarget {
    static readonly EMPTY = 0
    static readonly LOADING = 1
    static readonly DONE = 2
    readyState = 0
    result: string | ArrayBuffer | null = null
    error: DOMException | null = null
    onload: ((event: ProgressEvent) => void) | null = null
    onerror: ((event: ProgressEvent) => void) | null = null
    onloadend: ((event: ProgressEvent) => void) | null = null

    private read(blob: Blob, decode: (blob: Blob) => Promise<string | ArrayBuffer>): void {
      this.readyState = 1
      void decode(blob).then(
        result => {
          this.result = result
          this.readyState = 2
          const event = new Event("load") as ProgressEvent
          this.onload?.(event)
          this.dispatchEvent(event)
          this.onloadend?.(event)
          this.dispatchEvent(new Event("loadend"))
        },
        (error: unknown) => {
          this.error = error as DOMException
          this.readyState = 2
          const event = new Event("error") as ProgressEvent
          this.onerror?.(event)
          this.dispatchEvent(event)
          this.onloadend?.(event)
          this.dispatchEvent(new Event("loadend"))
        }
      )
    }

    readAsArrayBuffer(blob: Blob): void {
      this.read(blob, value => value.arrayBuffer())
    }

    readAsText(blob: Blob): void {
      this.read(blob, value => value.text())
    }

    readAsDataURL(blob: Blob): void {
      this.read(blob, async value => {
        const bytes = Buffer.from(await value.arrayBuffer())
        return `data:${value.type || "application/octet-stream"};base64,${bytes.toString("base64")}`
      })
    }

    abort(): void {}
  } as unknown as typeof FileReader
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom implements neither observer; components only need them to exist.
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!("IntersectionObserver" in globalThis)) {
    globalThis.IntersectionObserver = class {
      readonly root = null
      readonly rootMargin = ""
      readonly thresholds: readonly number[] = []
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    } as unknown as typeof IntersectionObserver
  }
  if (typeof globalThis.CSS?.escape !== "function") {
    globalThis.CSS = { ...globalThis.CSS, escape: (value: string) => value.replace(/["\\]/g, "\\$&") } as typeof CSS
  }
  // Markdown and highlight workers run in-process: real parsing, no native worker.
  globalThis.Worker = ChatWorkerStub as unknown as typeof Worker
}

vi.mock("@tauri-apps/plugin-log", () => ({
  attachConsole: vi.fn(async () => () => {}),
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  error: vi.fn(async () => {}),
  debug: vi.fn(async () => {})
}))
