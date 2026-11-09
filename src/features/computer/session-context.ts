import { computerContext } from "@alwith/module-computer"
import { commands } from "@alwith/module-computer/commands"
import { isTauri } from "@tauri-apps/api/core"

import type { ClientOptions } from "@/agent/client"
import { deviceSessionContext } from "@/features/device/session-context"
import { driveSessionContext } from "@/features/drive/session-context"

/** Computer attachment failures belong to the optional tool channel, not the conversation. */
async function computerSessionContext() {
  try {
    const descriptor = await commands.context()
    const context = await computerContext(() => Promise.resolve(descriptor?.connection ?? null))
    return {
      mcpServers: context.mcpServers,
      appendSystemPrompt: context.appendSystemPrompt,
      bind: descriptor
        ? (sessionId: string) => {
            // Tool calls wait for their explicit binding in native; replay never waits for it.
            void commands.bind({ token: descriptor.token, sessionId }).catch((error: unknown) => {
              console.error("Cannot bind computer access", error)
            })
          }
        : undefined
    }
  } catch (error) {
    console.error("Cannot attach computer tools", error)
    return { mcpServers: [], appendSystemPrompt: undefined, bind: undefined }
  }
}

export const hostSessionContext: NonNullable<ClientOptions["sessionContext"]> = async (cwd) => {
  const drive = await driveSessionContext(cwd)
  if (!isTauri()) return drive
  const computer = await computerSessionContext()
  const device = await deviceSessionContext()
  const appendSystemPrompt = [drive.appendSystemPrompt, computer.appendSystemPrompt, device.appendSystemPrompt]
    .filter(Boolean)
    .join("\n\n")
  const binders = [computer.bind, device.bind].filter((bind) => bind !== undefined)
  return {
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
