import type { ThreadSummary } from "@/agent/client"
import type { ComposerDraft } from "@/features/chat/composer/drafts"
import type { ChatTransfer } from "@/lib/chat-window"

export type SelectThreadActions = {
  connect: () => Promise<void>
  unarchive: (id: string) => Promise<void>
  release: (id: string) => Promise<ChatTransfer | null>
  importDraft: (id: string, draft: ComposerDraft | null) => void
  open: (id: string, cwd: string) => Promise<void>
  show: (id: string) => void
  onOpenError: (error: unknown) => void
}

export async function selectThread(thread: ThreadSummary, actions: SelectThreadActions): Promise<void> {
  await actions.connect()
  if (thread.archived) await actions.unarchive(thread.sessionId)
  const transfer = await actions.release(thread.sessionId)
  if (transfer) actions.importDraft(thread.sessionId, transfer.draft)
  const opening = actions.open(thread.sessionId, thread.cwd)
  actions.show(thread.sessionId)
  void opening.catch(actions.onOpenError)
}
