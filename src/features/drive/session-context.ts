import type { ClientOptions } from "@/agent/client"
import type { DriveRequest, DriveResponse } from "@alwith/module-drive"
import { invoke, isTauri } from "@tauri-apps/api/core"

async function request(value: DriveRequest): Promise<DriveResponse> {
  return invoke<DriveResponse>("drive_request", { request: value })
}

/** Credentials exist only in the session assembly request, never the application store. */
export const driveSessionContext: NonNullable<ClientOptions["sessionContext"]> = async cwd => {
  if (!isTauri()) return { mcpServers: [] }
  const snapshot = await request({ type: "snapshot" })
  if (snapshot.type !== "snapshot") throw new Error("Invalid Drive snapshot response")
  if (!snapshot.data.configured) return { mcpServers: [] }
  const [mcp, preferences] = await Promise.all([
    request({ type: "mcpSessionConfig" }),
    request({ type: "preferences" })
  ])
  if (mcp.type !== "mcpSessionConfig" || preferences.type !== "preferences")
    throw new Error("Invalid Drive session configuration")
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
    mcpServers: mcp.data ? [{ type: "http", name: "yup-drive", url: mcp.data.url, headers: mcp.data.headers }] : [],
    ...(appendSystemPrompt ? { appendSystemPrompt } : {})
  }
}
