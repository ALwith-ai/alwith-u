// Component tests call `installDom()` right after their imports: it turns the bun test
// process into a browser (happy-dom) for the duration of that file and hands Node back in
// `afterAll`, so the node-only suites (src/core, src/agent, packages) that share the process
// are not affected. The hook binds to the calling file, so every DOM test file installs its
// own; a plain side-effect import would run once for the first file only (modules are cached).
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll } from "bun:test"
import { ChatWorkerStub } from "./chat-worker-stub"

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class NoopIntersectionObserver {
  readonly root = null
  readonly rootMargin = ""
  readonly thresholds: number[] = []
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

export function installDom(): void {
  const originalWorker = globalThis.Worker
  // Synchronous: module-level code in the test file (captured natives, module caches)
  // must already see the browser globals.
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
  globalThis.Worker = ChatWorkerStub as unknown as typeof Worker
  {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const globals = globalThis as unknown as {
      ResizeObserver?: typeof ResizeObserver
      IntersectionObserver?: typeof IntersectionObserver
      CSS?: { escape?: (value: string) => string }
    }
    if (typeof globals.ResizeObserver === "undefined")
      globals.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
    if (typeof globals.IntersectionObserver === "undefined")
      globals.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver
    if (typeof globals.CSS?.escape !== "function")
      globals.CSS = { ...globals.CSS, escape: (value: string) => value.replace(/["\\]/g, "\\$&") }
  }
  afterAll(async () => {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
    globalThis.Worker = originalWorker
  })
}
