import { deviceContext } from "@alwith/module-device"
import { isTauri } from "@tauri-apps/api/core"

import { commands } from "@/bindings"

/** The device server for one new agent session, or nothing when the platform has no simulators. */
export async function deviceSessionContext(): Promise<{
  mcpServers: Awaited<ReturnType<typeof deviceContext>>["mcpServers"]
  appendSystemPrompt?: string
  bind?: (sessionId: string) => Promise<void>
}> {
  if (!isTauri()) return { mcpServers: [] }
  let descriptor: Awaited<ReturnType<typeof commands.deviceContext>> | null = null
  try {
    descriptor = await commands.deviceContext()
  } catch {
    return { mcpServers: [] }
  }
  if (!descriptor) return { mcpServers: [] }
  const context = await deviceContext(() => Promise.resolve(descriptor.registration), descriptor.carrier)
  const token = descriptor.registration.token
  return {
    mcpServers: context.mcpServers,
    ...(context.appendSystemPrompt ? { appendSystemPrompt: context.appendSystemPrompt } : {}),
    bind: async (sessionId: string) => {
      await commands.deviceBind({ token, sessionId })
    }
  }
}
