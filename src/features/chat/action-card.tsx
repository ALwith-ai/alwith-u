import {
  ActionCard as ConversationActionCard,
  ElicitationForm,
  type FormAction,
  type RespondTo
} from "@alwith/module-chat/conversation"
// Requests outside a conversation view (global elicitations, provider sign-in) render the
// package cards with U's host and client.
import type { PendingAction } from "@nyssance/codex-acp-v2/client"

import { ChatHostProvider } from "./chat-host"

export function ActionCard({ action, onRespond }: { action: PendingAction; onRespond?: RespondTo }) {
  return (
    <ChatHostProvider>
      <ConversationActionCard action={action} onRespond={onRespond} />
    </ChatHostProvider>
  )
}

export function ElicitationFormDialog({ action, total }: { action: FormAction; total: number }) {
  return (
    <ChatHostProvider>
      <ElicitationForm action={action} total={total} />
    </ChatHostProvider>
  )
}
