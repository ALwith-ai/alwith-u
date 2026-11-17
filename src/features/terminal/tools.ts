import { defineApplicationTool } from "@alwith/module-chat/client"
import type { TerminalClient, TerminalSnapshot } from "@alwith/module-terminal"

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Expected terminal arguments")
  return input as Record<string, unknown>
}
function text(input: Record<string, unknown>, key: string): string {
  if (typeof input[key] !== "string" || input[key].length === 0) throw new Error(`${key} is required`)
  return input[key]
}
/** Application tools bind every native operation to the requesting conversation. */
export function createTerminalTools(service: TerminalClient, cwd: string) {
  const properties = { terminalId: { type: "string" }, command: { type: "string" }, data: { type: "string" } }
  const definitions = [
    {
      name: "terminal_start",
      description:
        "Start an application-owned headless shell or development server in this chat's project. No terminal view is required. Keep the returned terminalId for subsequent operations.",
      keys: ["command"],
      required: ["command"]
    },
    {
      name: "terminal_list",
      description:
        "List application-owned terminals for this chat. These are separate from agent exec_command processes.",
      keys: [],
      required: []
    },
    {
      name: "read_thread_terminal",
      description:
        "Read this chat's application terminal output and status. Omit terminalId to read its active terminal. Does not start a terminal.",
      keys: ["terminalId"],
      required: []
    },
    {
      name: "terminal_write",
      description:
        "Write input to an existing application-owned terminal in this chat. Include a newline to execute a shell command, or a control character to interrupt it.",
      keys: ["terminalId", "data"],
      required: ["terminalId", "data"]
    },
    {
      name: "terminal_stop",
      description:
        "Stop this chat's named application terminal and its child processes. Retains bounded output and exit status.",
      keys: ["terminalId"],
      required: ["terminalId"]
    },
    {
      name: "terminal_close",
      description: "Stop and remove this chat's named application terminal and its bounded output.",
      keys: ["terminalId"],
      required: ["terminalId"]
    },
    {
      name: "terminal_restart",
      description:
        "Stop the named application terminal and rerun its saved startup command, optionally replacing that command.",
      keys: ["terminalId", "command"],
      required: ["terminalId"]
    }
  ] as const
  return definitions.map((definition) =>
    defineApplicationTool({
      name: definition.name,
      description: definition.description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(definition.keys.map((key) => [key, properties[key]])),
        required: [...definition.required],
        additionalProperties: false
      },
      ...(definition.name === "terminal_list" || definition.name === "read_thread_terminal"
        ? { annotations: { readOnlyHint: true } }
        : {}),
      parse(input: unknown) {
        const args = object(input)
        for (const key of Object.keys(args))
          if (!(definition.keys as readonly string[]).includes(key))
            throw new Error(`Unexpected terminal argument: ${key}`)
        for (const key of definition.required) text(args, key)
        for (const key of definition.keys)
          if (key in args && typeof args[key] !== "string") throw new Error(`${key} must be text`)
        return args
      },
      async execute(args, context) {
        const sessionId = context.sessionId
        let result: unknown
        if (definition.name === "terminal_start")
          result = await service.start({ sessionId, cwd, command: text(args, "command") })
        else if (definition.name === "terminal_list") result = await service.list(sessionId)
        else {
          const snapshot = await service.snapshot(
            sessionId,
            typeof args.terminalId === "string" ? args.terminalId : undefined
          )
          if (!snapshot)
            return { content: [{ type: "text", text: "No application terminal is attached to this chat." }] }
          if (definition.name === "read_thread_terminal") result = snapshot
          else if (definition.name === "terminal_write") {
            await service.write(snapshot, text(args, "data"))
            result = await service.snapshot(sessionId, snapshot.terminalId)
          } else if (definition.name === "terminal_stop") result = await service.stop(snapshot)
          else if (definition.name === "terminal_close") result = await service.close(snapshot)
          else
            result = await service.restartAction(
              sessionId,
              snapshot.terminalId,
              typeof args.command === "string" ? args.command : undefined
            )
        }
        const readable = (snapshot: TerminalSnapshot) => {
          const { outputBase64: _output, screenBase64: _screen, ...metadata } = snapshot
          return metadata
        }
        const data = Array.isArray(result)
          ? (result as TerminalSnapshot[]).map(readable)
          : result
            ? readable(result as TerminalSnapshot)
            : null
        return { content: [{ type: "text", text: JSON.stringify(data) }] }
      }
    })
  )
}
