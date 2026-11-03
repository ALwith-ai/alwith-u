import { computerContext } from "@alwith/module-computer"
import { commands } from "@alwith/module-computer/commands"
import { isTauri } from "@tauri-apps/api/core"

import type { ClientOptions } from "@/agent/client"
import { deviceSessionContext } from "@/features/device/session-context"
import { driveSessionContext } from "@/features/drive/session-context"
import i18n from "@/lib/i18n"
import { text } from "@/lib/text"

export async function computerContextRevision(): Promise<string> {
  if (!isTauri()) return "disabled"
  return commands.revision()
}

export const hostSessionContext: NonNullable<ClientOptions["sessionContext"]> = async (cwd) => {
  const drive = await driveSessionContext(cwd)
  if (!isTauri()) return { ...drive, revision: "disabled" }
  const descriptor = await commands.context()
  const computer = await computerContext(() => Promise.resolve(descriptor?.connection ?? null))
  const device = await deviceSessionContext()
  const appendSystemPrompt = [drive.appendSystemPrompt, computer.appendSystemPrompt, device.appendSystemPrompt]
    .filter(Boolean)
    .join("\n\n")
  const binders = [
    descriptor
      ? async (sessionId: string) => {
          await commands.bind({ token: descriptor.token, sessionId })
        }
      : undefined,
    device.bind
  ].filter((bind) => bind !== undefined)
  return {
    revision: computer.revision,
    bind:
      binders.length > 0
        ? async (sessionId: string) => {
            for (const bind of binders) await bind(sessionId)
          }
        : undefined,
    mcpServers: [...drive.mcpServers, ...computer.mcpServers, ...device.mcpServers],
    ...(appendSystemPrompt ? { appendSystemPrompt } : {})
  }
}

/** A failed preflight keeps the message unsent; sending again retries the connection. */
export async function prepareComputerTools(sessionId: string): Promise<void> {
  if (!isTauri()) return
  try {
    await commands.ready({ sessionId })
  } catch (error) {
    throw new Error(i18n.t("computer.connectionError", { error: text(error) }), { cause: error })
  }
}
