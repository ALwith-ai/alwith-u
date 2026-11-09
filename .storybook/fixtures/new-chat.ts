import { drafts, importDraft } from "@alwith/module-chat/conversation"
import type { LoaderFunction } from "storybook/internal/types"

import { newChatDirectory } from "../../src/features/chat/new-chat-directory"
import { makeSession, PROJECT_DIRECTORY } from "./catalog"
import { client, runState } from "./client"
import type { PreviewState } from "./prepare"

export async function resetMainDraft(directory: string | null): Promise<string | null> {
  const target = newChatDirectory(directory, client.state.projectContext)
  await client.discardDraft("main")
  importDraft("draft", null)
  return target
}

/** Prepare the outcome before rendering, so examples never flash the source conversation. */
export const prepareNewChatExample: LoaderFunction = async ({ args, parameters }) => {
  const state = args as PreviewState
  const directory = state.initialDirectory === undefined ? PROJECT_DIRECTORY : state.initialDirectory
  const origin = parameters.newChatFrom as string | undefined
  if (origin && ["running", "completed", "cancelled", "stopped"].includes(origin)) {
    const kind = origin === "completed" ? "conversation" : "running"
    const session = makeSession(kind, "previous-chat")
    client.store.setState((current) => ({
      sessions: { ...current.sessions, [session.id]: session },
      runStates: { ...current.runStates, [session.id]: runState(session.id, kind === "running" ? "running" : "done") },
      sessionList: [{ sessionId: session.id, cwd: session.cwd, title: "新建前的会话", archived: false, updatedAt: new Date().toISOString() }, ...current.sessionList]
    }))
    if (origin === "cancelled") await client.cancel(session.id)
    if (origin === "stopped") await client.stopSession(session.id)
  }
  if (origin === "draft" || origin === "repeat") {
    const id = await client.prepareDraft("main", directory ?? undefined)
    importDraft(id, { text: "尚未发送的旧草稿", attachments: [], mentions: [], modelId: null })
    importDraft("draft", { text: "占位输入也应清空", attachments: [], mentions: [], modelId: null })
  }
  await resetMainDraft(directory)
  if (origin === "repeat") await resetMainDraft(directory)
  if (drafts.has("draft") || Object.values(client.state.draftSessions).includes("main"))
    throw new Error("The new-chat example retained an abandoned draft")
}
