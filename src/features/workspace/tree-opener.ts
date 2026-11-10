import type { FileTabsController } from "@alwith/module-editor/tabs/core"

/** Desktop selectFile policy: one transient preview; double-click and edits pin it. */
export function createTreeOpener(
  tabs: FileTabsController,
  prepare: (path: string) => Promise<string | null> = (path) => Promise.resolve(path)
): {
  open: (path: string, pinned?: boolean) => Promise<void>
  dispose: () => void
} {
  let disposed = false
  let pending: Promise<void> = Promise.resolve()
  return {
    open(path, pinned = false) {
      const open = async (): Promise<void> => {
        if (disposed) return
        const destination = await prepare(path)
        if (destination === null || disposed) return
        await tabs.openFile(destination, pinned)
      }
      // Both branches run the next user action; each returned rejection is still reported by the caller.
      pending = pending.then(open, open)
      return pending
    },
    dispose: () => {
      disposed = true
    }
  }
}
