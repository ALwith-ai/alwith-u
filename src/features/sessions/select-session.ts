import type { SessionSummary } from "@alwith/module-chat/client"
import type { ComposerDraft } from "@alwith/module-chat/conversation"

import { errorMessage, logBackgroundError } from "@/lib/background-errors"
import type { ChatTransfer } from "@/lib/chat-window"

export type SelectSessionActions = {
  connect: () => Promise<void>
  discardDraft: (id: string) => Promise<void>
  unarchive: (id: string) => Promise<void>
  release: (id: string) => Promise<ChatTransfer | null>
  transferDraft: (id: string) => Promise<void>
  importDraft: (id: string, draft: ComposerDraft | null) => void
  include: (sessionRow: SessionSummary) => void
  open: (id: string, cwd: string) => Promise<void>
  show: (id: string) => void
  onOpenError: (error: unknown) => void
}

export async function selectSession(sessionRow: SessionSummary, actions: SelectSessionActions): Promise<void> {
  const { sessionId, cwd, archived } = sessionRow
  let stage = "connect"
  try {
    await actions.connect()
    stage = "discard-draft"
    await actions.discardDraft(sessionId)
    if (archived) {
      stage = "unarchive"
      await actions.unarchive(sessionId)
    }
    stage = "release-window"
    const transfer = await actions.release(sessionId)
    stage = "transfer-draft"
    await actions.transferDraft(sessionId)
    if (transfer) {
      stage = "import-draft"
      actions.importDraft(sessionId, transfer.draft)
    }
    stage = "include-session"
    actions.include({ ...sessionRow, archived: false })
    stage = "open-session"
    void actions.open(sessionId, cwd).catch((error: unknown) => {
      logBackgroundError("session-selection/open-session", errorMessage(error))
      actions.onOpenError(error)
    })
    stage = "show-session"
    actions.show(sessionId)
  } catch (error) {
    logBackgroundError(`session-selection/${stage}`, errorMessage(error))
    throw error
  }
}
