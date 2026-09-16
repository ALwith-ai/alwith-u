import { terminalOf, textOf, type MessageItem, type Terminal, type ToolItem } from "@alwith/api"
import type { CodexActivityBlock } from "@alwith/chat/group-blocks"

/** Adapt display data only; session updates, tool patches and terminal streams are folded by @alwith/api. */
export function projectActivity(item: MessageItem | ToolItem, terminals: Record<string, Terminal>, streaming: boolean): CodexActivityBlock {
  if (item.kind !== "tool") {
    return { type: "thinking", id: item.id, thinking: textOf(item.content), isComplete: !streaming }
  }
  if (item.name === "subagent" || item.name === "collab") {
    return { type: "subagent", id: item.id, name: item.title ?? item.name, status: item.status ?? "pending", blocks: [] }
  }
  const rawInput = typeof item.rawInput === "object" && item.rawInput !== null && !Array.isArray(item.rawInput)
    ? { ...item.rawInput } as Record<string, unknown> : {}
  const terminal = terminalOf(item, terminals)
  if (Array.isArray(rawInput.command)) rawInput.command = rawInput.command.map(String).join(" ")
  if (item.toolKind === "execute" && typeof rawInput.command !== "string") {
    const command = terminal?.command ?? item.title
    if (command !== null) rawInput.command = command
  }
  let rawOutput = item.rawOutput
  if (typeof rawOutput === "object" && rawOutput !== null && "output" in rawOutput && typeof rawOutput.output === "string") rawOutput = rawOutput.output
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
