import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { isToolCallSubject } from "@alwith/api"

import type { CodexClient } from "@/agent/client"

export type MobilePrompt = {
  sessionId: string
  text: string
  files?: { url: string; mediaType?: string }[]
  deviceId?: string
  clientRequestId?: string
}
export type MobilePermission = {
  sessionId: string
  toolCallId: string
  outcome: acp.RequestPermissionResponse["outcome"]
}
type Client = Pick<CodexClient, "state" | "openRemote" | "prompt" | "cancel" | "respond">

export async function sendMobilePrompt(
  client: Client,
  { sessionId, text, files = [], deviceId, clientRequestId }: MobilePrompt
): Promise<string> {
  const prompt: acp.ContentBlock[] = []
  if (text) prompt.push({ type: "text", text })
  for (const file of files) prompt.push({ type: "image", data: file.url, mimeType: file.mediaType ?? "image/jpeg" })
  await client.openRemote(sessionId)
  return client.prompt(
    sessionId,
    prompt,
    clientRequestId ? { meta: { mobile: { deviceId, clientRequestId } } } : undefined
  )
}

export function respondMobilePermission(client: Client, { sessionId, toolCallId, outcome }: MobilePermission): void {
  const action = client.state.actions.find(
    (action) =>
      action.kind === "permission" &&
      action.sessionId === sessionId &&
      action.params.subject != null &&
      isToolCallSubject(action.params.subject) &&
      action.params.subject.toolCall.toolCallId === toolCallId
  )
  // Another surface may have answered while this response was in transit.
  if (!action) return
  client.respond(action.id, { outcome })
}
