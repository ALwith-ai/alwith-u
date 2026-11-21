import { array, object, type ObjectValue, string } from "./native"

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid history text")
  return value
}

function media(url: string, kind: string): ObjectValue {
  // Do not open local paths or fetch remote URLs named in conversation data.
  const comma = url.indexOf(",")
  if (url.startsWith("data:") && comma > 5 && url.slice(5, comma).endsWith(";base64")) {
    return { type: kind, mimeType: url.slice(5, comma - 7), data: url.slice(comma + 1) }
  }
  return { type: "resource_link", uri: url, name: kind }
}

function userBlock(value: unknown): ObjectValue {
  const block = object(value)
  switch (block.type) {
    case "text":
      return { type: "text", text: text(block.text) }
    case "audio":
    case "image":
      return media(string(block.url ?? block.fileId), block.type)
    default:
      return { type: "resource_link", name: String(block.name ?? block.type), uri: string(block.path) }
  }
}

export function project(item: ObjectValue, turnId: string): ObjectValue[] {
  const id = string(item.id)
  const meta = { codex: { historyItemId: id, turnId } }
  const message = (kind: string, messageId: string, content: ObjectValue[]) => ({
    sessionUpdate: kind,
    messageId,
    content,
    _meta: meta
  })
  const status =
    item.status === "failed" || item.success === false
      ? "failed"
      : item.status === "inProgress"
        ? "in_progress"
        : "completed"
  const tool = (title: string, kind: string, details: ObjectValue) => ({
    sessionUpdate: "tool_call",
    toolCallId: id,
    title,
    kind,
    status,
    _meta: meta,
    ...details
  })
  switch (item.type) {
    case "userMessage":
      return [
        message(
          "user_message",
          typeof item.clientId === "string" && item.clientId.trim() ? item.clientId : id,
          array(item.content).map(userBlock)
        )
      ]
    case "agentMessage": {
      // The history worker never sends intermediate commentary as answer text, even to older phones.
      const phase = array(item.questions ?? []).length ? "final_answer" : item.phase
      const commentary = phase === "commentary"
      const update = message(commentary ? "agent_thought" : "agent_message", id,
        commentary ? [] : [{ type: "text", text: text(item.text) }])
      return [{ ...update, _meta: { codex: { ...meta.codex, ...(phase ? { phase } : {}),
        ...(commentary ? { historyThought: true } : {}) } } }]
    }
    case "reasoning": {
      const thought = message("agent_thought", id, [])
      const { startedAtMs, completedAtMs } = item
      if (typeof startedAtMs === "number" && Number.isSafeInteger(startedAtMs) && startedAtMs >= 0 &&
          typeof completedAtMs === "number" && Number.isSafeInteger(completedAtMs) && completedAtMs >= startedAtMs) {
        return [{ ...thought, _meta: { codex: { ...meta.codex, reasoningDurationMs: completedAtMs - startedAtMs } } }]
      }
      return [thought]
    }
    case "plan":
      return [
        { sessionUpdate: "plan_update", plan: { type: "markdown", planId: id, content: text(item.text) }, _meta: meta }
      ]
    case "commandExecution": {
      const terminalId = id
      const command = text(item.command)
      return [
        tool(command, "execute", {
          content: [{ type: "terminal", terminalId }],
          rawInput: { command, cwd: item.cwd },
          rawOutput: { exitCode: item.exitCode }
        }),
        {
          sessionUpdate: "terminal_update",
          terminalId,
          command,
          output: { data: Buffer.from(text(item.aggregatedOutput ?? "")).toString("base64") },
          _meta: meta
        }
      ]
    }
    case "fileChange":
      return [
        tool("Editing files", "edit", {
          content: array(item.changes).map((change) => {
            const entry = object(change)
            return { type: "diff", path: entry.path, patch: { text: text(entry.diff) } }
          })
        })
      ]
    case "mcpToolCall":
      return [
        tool("mcp." + string(item.server) + "." + string(item.tool), "execute", {
          rawInput: { server: item.server, tool: item.tool, arguments: item.arguments },
          rawOutput: { result: item.result, error: item.error }
        })
      ]
    case "dynamicToolCall":
      return [
        tool(string(item.tool), "other", {
          rawInput: item.arguments,
          content: array(item.contentItems ?? []).map((value) => {
            const block = object(value)
            return {
              type: "content",
              content:
                block.type === "inputText"
                  ? { type: "text", text: text(block.text) }
                  : media(string(block.imageUrl ?? block.audioUrl), block.type === "inputImage" ? "image" : "audio")
            }
          })
        })
      ]
    case "imageGeneration": {
      const block =
        typeof item.result === "string" && item.result
          ? { type: "image", mimeType: "image/png", data: item.result }
          : { type: "resource_link", name: "Image", uri: string(item.fileId ?? item.savedPath) }
      return [tool("Image generation", "other", { content: [{ type: "content", content: block }] })]
    }
    case "functionCallOutput":
      return [tool(string(item.name), "other", { rawOutput: item.output })]
    default:
      return [tool(string(item.type), "other", { rawOutput: item })]
  }
}
