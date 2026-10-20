import { computerContext } from "@alwith/module-computer"
import { isTauri } from "@tauri-apps/api/core"
import type { ClientOptions } from "@/agent/client"
import i18n from "@/lib/i18n"
import { commands } from "@/bindings"
import { driveSessionContext } from "@/features/drive/session-context"

export async function computerContextRevision(): Promise<string> {
  if (!isTauri()) return "disabled"
  return commands.computerRevision()
}

export const hostSessionContext: NonNullable<ClientOptions["sessionContext"]> = async cwd => {
  const drive = await driveSessionContext(cwd)
  if (!isTauri()) return { ...drive, revision: "disabled" }
  const descriptor = await commands.computerContext()
  const computer = await computerContext(async () => descriptor?.connection ?? null)
  const appendSystemPrompt = [drive.appendSystemPrompt, computer.appendSystemPrompt].filter(Boolean).join("\n\n")
  return {
    revision: computer.revision,
    bind: descriptor
      ? async (sessionId: string) => {
          await commands.computerBind({ token: descriptor.token, sessionId })
        }
      : undefined,
    mcpServers: [...drive.mcpServers, ...computer.mcpServers],
    ...(appendSystemPrompt ? { appendSystemPrompt } : {})
  }
}

/** A failed preflight keeps the message unsent; sending again retries the connection. */
export async function prepareComputerTools(sessionId: string): Promise<void> {
  if (!isTauri()) return
  try {
    await commands.computerReady({ sessionId })
  } catch (error) {
    throw new Error(i18n.t("computer.connectionError", { error: String(error) }), { cause: error })
  }
}
