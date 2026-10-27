import type { ComposerDraft } from "@alwith/module-chat/conversation"

import type { SessionSummary } from "@/agent/client"
import type { ChatTransfer } from "@/lib/chat-window"

export type SelectSessionActions = {
  connect: () => Promise<void>
  unarchive: (id: string) => Promise<void>
  release: (id: string) => Promise<ChatTransfer | null>
  importDraft: (id: string, draft: ComposerDraft | null) => void
  include: (sessionRow: SessionSummary) => void
  open: (id: string, cwd: string) => Promise<void>
  show: (id: string) => void
  onOpenError: (error: unknown) => void
}

export async function selectSession(sessionRow: SessionSummary, actions: SelectSessionActions): Promise<void> {
  await actions.connect()
  if (sessionRow.archived) await actions.unarchive(sessionRow.sessionId)
  const transfer = await actions.release(sessionRow.sessionId)
  if (transfer) actions.importDraft(sessionRow.sessionId, transfer.draft)
  actions.include({ ...sessionRow, archived: false })
  const opening = actions.open(sessionRow.sessionId, sessionRow.cwd)
  actions.show(sessionRow.sessionId)
  void opening.catch(actions.onOpenError)
}
