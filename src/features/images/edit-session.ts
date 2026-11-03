import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import type { SessionSummary } from "@alwith/module-chat/client"

import type { CodexClient } from "@/agent/client"
import { IMAGE_THREAD_SOURCE, isImageSession } from "@/agent/session-kind"

type EditClient = Pick<CodexClient, "state" | "newImageSession" | "open" | "promptWithImages" | "discardDraft">

/** Ordinary chats supply references to a new image thread; image threads keep their own context. */
export async function submitImageEdit(
  client: EditClient,
  source: SessionSummary,
  prompt: acp.ContentBlock[],
  notReady: string
): Promise<SessionSummary> {
  if (client.state.connection !== "ready") throw new Error(notReady)
  let created: string | undefined
  let accepted = false
  try {
    let id = source.sessionId
    if (isImageSession(source)) await client.open(id, source.cwd)
    else {
      id = await client.newImageSession(undefined, { draft: true, from: source.sessionId })
      created = id
    }
    const current = client.state.sessions[id]
    if (!current?.attached || current.restoring || current.readOnly || current.state !== "idle")
      throw new Error(notReady)
    await client.promptWithImages(id, prompt)
    accepted = true
    return {
      sessionId: id,
      cwd: current.cwd,
      title: current.title,
      updatedAt: null,
      archived: false,
      threadSource: IMAGE_THREAD_SOURCE
    }
  } finally {
    // This only removes an unmaterialized draft; an accepted native conversation is retained.
    if (created && !accepted) await client.discardDraft(created)
  }
}
