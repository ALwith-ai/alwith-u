import type { ApplicationTool, ApplicationToolResult, ApplicationToolSelection } from "@alwith/module-chat/client"
import { defineApplicationTool } from "@alwith/module-chat/client"
import { commands, isNativeError } from "@alwith/module-computer/commands"
import { invoke } from "@tauri-apps/api/core"

const nativeComputerTool = Symbol("nativeComputerTool")

type Definition = Pick<
  Parameters<typeof defineApplicationTool>[0],
  "name" | "title" | "description" | "inputSchema" | "annotations"
>

export async function createComputerApplicationTools(
  selection?: ApplicationToolSelection & { previousTools?: readonly ApplicationTool[] }
) {
  let definitions: Definition[]
  try {
    definitions = await invoke<Definition[]>("plugin:alwith-computer|application_tools")
  } catch (error) {
    console.error("Cannot discover computer application tools", error)
    return selection?.previousTools?.filter((tool) => nativeComputerTool in tool) ?? []
  }
  return definitions.map(({ name, ...definition }) => {
    const tool = defineApplicationTool({
      ...definition,
      name: `computer_${name}`,
      parse(input: unknown) {
        if (typeof input !== "object" || input === null || Array.isArray(input)) {
          throw new Error("Expected computer tool arguments")
        }
        return input
      },
      async execute(args, { sessionId, signal }) {
        signal.throwIfAborted()
        const stop = () => void commands.stopSession({ sessionId }).catch(console.error)
        signal.addEventListener("abort", stop, { once: true })
        try {
          const result = await invoke<ApplicationToolResult>("plugin:alwith-computer|call_application_tool", {
            sessionId,
            name,
            arguments: args
          })
          signal.throwIfAborted()
          return result
        } catch (error) {
          signal.throwIfAborted()
          if (!isNativeError(error)) throw error
          return {
            isError: true,
            content: [{ type: "text", text: error.message }],
            structuredContent: { code: error.code, message: error.message }
          }
        } finally {
          signal.removeEventListener("abort", stop)
        }
      }
    })
    return { ...tool, [nativeComputerTool]: true }
  })
}
