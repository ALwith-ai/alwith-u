import { defineApplicationTool } from "@alwith/module-chat/client"
import { callDeviceTool, deviceToolDefinitions } from "@alwith/module-device/tauri"

/** The chat adapter transports these callbacks; the shared native module owns execution. */
export async function createDeviceTools(projectPath?: string) {
  const definitions = await deviceToolDefinitions()
  return definitions.map((definition) =>
    defineApplicationTool({
      ...definition,
      name: `device_${definition.name}`,
      parse(input: unknown) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected device arguments")
        return input as Record<string, unknown>
      },
      async execute(args, { sessionId, toolCallId, signal }) {
        const result = await callDeviceTool(definition.name, args, {
          sessionId,
          requestId: toolCallId,
          signal,
          projectPath
        })
        return { ...result }
      }
    })
  )
}
