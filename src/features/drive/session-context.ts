import type { DriveRequest, DriveResponse } from "@alwith/module-drive"
import { invoke, isTauri } from "@tauri-apps/api/core"
import type { ClientOptions } from "@/agent/client"

async function request(value: DriveRequest): Promise<DriveResponse> {
  return invoke<DriveResponse>("drive_request", { request: value })
}

/** Drive contributes REST-backed knowledge; optional connectors are configured independently. */
export const driveSessionContext = (async (cwd: string) => {
  if (!isTauri()) return { mcpServers: [] }
  const snapshot = await request({ type: "snapshot" })
  if (snapshot.type !== "snapshot") throw new Error("Invalid Drive snapshot response")
  if (!snapshot.data.configured) return { mcpServers: [] }
  const preferences = await request({ type: "preferences" })
  if (preferences.type !== "preferences") throw new Error("Invalid Drive session configuration")
  let appendSystemPrompt: string | undefined
  if (preferences.data.knowledgeInject) {
    const context = await request({ type: "knowledgeContext", cwd })
    if (context.type !== "text") throw new Error("Invalid Drive knowledge context")
    appendSystemPrompt = context.data ?? undefined
  }
  const current = await request({ type: "snapshot" })
  if (current.type !== "snapshot" || current.data.generation !== snapshot.data.generation) {
    throw new Error("Drive configuration changed while preparing this session. Try again.")
  }
  return {
    mcpServers: [],
    ...(appendSystemPrompt ? { appendSystemPrompt } : {})
  }
}) satisfies NonNullable<ClientOptions["sessionContext"]>
