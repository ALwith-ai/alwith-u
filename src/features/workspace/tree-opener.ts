import type { EditorController } from "@alwith/module-editor"

/** Desktop selectFile policy: one transient preview; double-click and edits pin it. */
export function createTreeOpener(editor: EditorController): {
  open(path: string, pinned?: boolean): Promise<void>
  dispose(): void
} {
  let preview: string | null = editor.getSnapshot().documents.find(document => !document.pinned)?.id ?? null
  let pending: Promise<void> = Promise.resolve()
  const unsubscribe = editor.subscribe(() => {
    if (preview === null) return
    const document = editor.getSnapshot().documents.find(doc => doc.id === preview)
    if (!document || document.dirty || document.pinned) preview = null
  })
  return {
    open(path, pinned = false) {
      const open = async (): Promise<void> => {
        const existing = editor.getSnapshot().documents.find(doc => doc.path === path)
        const previous = preview
        const document = await editor.open(path)
        if (pinned) {
          editor.pin(document.id)
          if (preview === document.id) preview = null
          return
        }
        if (existing) return
        if (previous !== null && preview === previous) {
          const old = editor.getSnapshot().documents.find(doc => doc.id === previous)
          if (old && !old.pinned && !old.dirty && !old.saving) await editor.requestClose(previous)
        }
        if (!document.dirty) preview = document.id
      }
      // Both branches run the next user action; each returned rejection is still reported by the caller.
      pending = pending.then(open, open)
      return pending
    },
    dispose: unsubscribe
  }
}
