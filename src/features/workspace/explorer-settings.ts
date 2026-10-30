import type { FileTreeController } from "@alwith/module-file-tree"

import { settingsStore, updateSettings } from "@/lib/settings-store"

const SHOW_HIDDEN = "explorer.showHidden"

export function loadExplorerShowHidden(): boolean {
  const value = settingsStore.get<unknown>(SHOW_HIDDEN)
  if (value === undefined) return false
  if (typeof value !== "boolean") throw new Error("Invalid explorer hidden-file setting")
  return value
}

export const saveExplorerShowHidden = (value: boolean): Promise<void> => updateSettings({ [SHOW_HIDDEN]: value })

export function subscribeExplorerSettings(listener: () => void): () => void {
  return settingsStore.subscribe((keys) => {
    if (keys.includes(SHOW_HIDDEN)) listener()
  })
}

/** Every tree projects the same committed preference; menu changes go through native settings. */
export async function connectExplorerSettings(
  tree: FileTreeController,
  report: (error: unknown) => void
): Promise<FileTreeController> {
  let disposed = false
  let pending = Promise.resolve()
  const sync = () => {
    pending = pending
      .catch(() => {})
      .then(async () => {
        if (disposed) return
        const value = loadExplorerShowHidden()
        if (tree.getSnapshot().showHidden !== value) await tree.setShowHidden(value)
      })
    return pending
  }
  const stop = subscribeExplorerSettings(() => void sync().catch(report))
  try {
    await sync()
  } catch (error) {
    stop()
    tree.dispose()
    throw error
  }
  return {
    ...tree,
    async setShowHidden(value) {
      await saveExplorerShowHidden(value)
      await sync()
    },
    dispose() {
      disposed = true
      stop()
      tree.dispose()
    }
  }
}
