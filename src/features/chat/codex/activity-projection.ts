import { type MessageItem, type Terminal, type ToolItem, terminalOf, textOf } from "@alwith/api"
import type { CodexActivityBlock } from "@alwith/module-chat/group-blocks"
import type { CollabAgent, CollabTool } from "@alwith/module-chat/types"

/** Adapt display data only; session updates, tool patches and terminal streams are folded by @alwith/api. */
export function projectActivity(
  item: MessageItem | ToolItem,
  terminals: Record<string, Terminal>,
  thinkingStreaming: boolean
): CodexActivityBlock {
  if (item.kind !== "tool") {
    const thinking = textOf(item.content)
    // The shared reasoning view removes a leading bold heading. Keep it as plain text
    // when the heading is the entire summary, so the expanded view is not empty.
    const headingOnly = /^\s*\*\*([^\n]*?)\*\*\s*$/.exec(thinking)
    return {
      type: "thinking",
      id: item.id,
      thinking: headingOnly ? headingOnly[1] : thinking,
      isComplete: !thinkingStreaming
    }
  }
  if (item.name === "subagent") {
    const input = recordOf(item.rawInput, item.id)
    return {
      type: "subagent",
      id: item.id,
      // Codex names a subagent by the last segment of its path, as the adapter's title does.
      name: agentName(input.agentPath, item.id),
      model: nullableString(input.model, "model", item.id),
      reasoningEffort: nullableString(input.reasoningEffort, "reasoningEffort", item.id),
      status: item.status ?? "pending",
      blocks: []
    }
  }
  if (item.name === "collab") {
    const collaboration = recordOf(recordOf(recordOf(item._meta, item.id).codex, item.id).collaboration, item.id)
    if (typeof collaboration.tool !== "string" || !Array.isArray(collaboration.agents)) {
      throw new Error(`Collaboration call ${item.id} lacks codex-acp-v2 agent metadata`)
    }
    return {
      type: "collab",
      id: item.id,
      tool: collaboration.tool as CollabTool,
      status: item.status ?? "pending",
      prompt: nullableString(recordOf(item.rawInput, item.id).prompt, "prompt", item.id),
      agents: collaboration.agents as CollabAgent[]
    }
  }
  const rawInput =
    typeof item.rawInput === "object" && item.rawInput !== null && !Array.isArray(item.rawInput)
      ? ({ ...item.rawInput } as Record<string, unknown>)
      : {}
  const terminal = terminalOf(item, terminals)
  if (Array.isArray(rawInput.command)) rawInput.command = rawInput.command.map(String).join(" ")
  if (item.toolKind === "execute" && typeof rawInput.command !== "string") {
    const command = terminal?.command ?? item.title
    if (command !== null) rawInput.command = command
  }
  let rawOutput = item.rawOutput
  if (
    typeof rawOutput === "object" &&
    rawOutput !== null &&
    "output" in rawOutput &&
    typeof rawOutput.output === "string"
  )
    rawOutput = rawOutput.output
  if (terminal !== null && terminal.output.length > 0) rawOutput = terminal.output
  const exitCode = terminal?.exitStatus?.exitCode
  return {
    type: "tool_use",
    id: item.id,
    name: item.name ?? "",
    title: item.title ?? item.name ?? "",
    kind: item.toolKind ?? "other",
    status: item.status ?? "pending",
    content: item.content,
    locations: item.locations,
    rawInput,
    rawOutput,
    ...(typeof exitCode === "number" ? { exitCode } : {})
  }
}

function recordOf(value: unknown, itemId: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Tool call ${itemId} is missing an object codex-acp-v2 always sends`)
  }
  return value as Record<string, unknown>
}

function nullableString(value: unknown, field: string, itemId: string): string | null {
  if (value === null || typeof value === "string") return value
  throw new Error(`Tool call ${itemId} has a non-string ${field}`)
}

function agentName(path: unknown, itemId: string): string {
  const name = typeof path === "string" ? path.split("/").filter(Boolean).at(-1) : undefined
  if (name === undefined) throw new Error(`Subagent ${itemId} has no agent path`)
  return name
}
