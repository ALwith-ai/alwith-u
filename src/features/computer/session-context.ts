import type { ClientOptions } from "@alwith/module-chat/client"
import { computerContext } from "@alwith/module-computer"
import { commands } from "@alwith/module-computer/commands"
import { isTauri } from "@tauri-apps/api/core"

import { deviceSessionContext } from "@/features/device/session-context"
import { driveSessionContext } from "@/features/drive/session-context"
import { browserSessionContext } from "@/features/web-automation/session-context"

// Older command clients accept the same call and ignore the optional resume hint.
const requestConnection: (args: { sessionId?: string }) => ReturnType<typeof commands.context> = commands.context

export async function hostSessionRevision(): Promise<string> {
  if (!isTauri()) return "unavailable"
  return commands.revision().catch(() => "unavailable")
}

/** Computer attachment failures belong to the optional tool channel, not the conversation. */
async function computerSessionContext(sessionId?: string) {
  try {
    const descriptor = await requestConnection(sessionId ? { sessionId } : {})
    const context = await computerContext(() => Promise.resolve(descriptor?.connection ?? null))
    return {
      revision: descriptor?.connection.generation ?? "unavailable",
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
    return { revision: "unavailable", mcpServers: [], appendSystemPrompt: undefined, bind: undefined }
  }
}

export const hostSessionContext: NonNullable<ClientOptions["sessionContext"]> = async (cwd, operation) => {
  const drive = await driveSessionContext(cwd)
  if (!isTauri()) return { ...drive, revision: "unavailable" }
  const computer = await computerSessionContext(operation.kind === "resume" ? operation.sessionId : undefined)
  const device = await deviceSessionContext()
  const browser = await browserSessionContext()
  const appendSystemPrompt = [
    "The desktop application is ALwith U. For questions about this app's features, setup or troubleshooting, use ALwith Docs when available and base answers on documentation for the installed ALwith U version.",
    drive.appendSystemPrompt,
    computer.appendSystemPrompt,
    device.appendSystemPrompt,
    browser.appendSystemPrompt
  ]
    .filter(Boolean)
    .join("\n\n")
  const binders = [computer.bind, browser.bind].filter((bind) => bind !== undefined)
  return {
    revision: computer.revision,
    bind:
      binders.length > 0
        ? async (sessionId: string) => {
            for (const bind of binders) await bind(sessionId)
          }
        : undefined,
    mcpServers: [...drive.mcpServers, ...computer.mcpServers, ...device.mcpServers, ...browser.mcpServers],
    ...(appendSystemPrompt ? { appendSystemPrompt } : {})
  }
}
