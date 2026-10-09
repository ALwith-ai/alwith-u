// The story module as seen from U: module calls go through the Runtime (`modules/alwith-story/<method>`),
// the story agent is started by the module (owner-scoped) and driven here over ACP like any other agent.
import { ContentBlock, SessionUpdate } from "@agentclientprotocol/sdk/experimental/v2"
import { Agent } from "@alwith/api"
import { runtimeClient } from "@/lib/runtime"

export const STORY_MODULE = "alwith-story"

export interface FrameSection {
  key: string
  text: string
}
export interface Frame {
  version: number
  sections: FrameSection[]
}
export interface LedgerEntry {
  seq: number
  branchId: string
  kind: "input" | "prose" | "event"
  text: string
  time: number
  source?: { sessionId: string; sequence: number }
}
export interface Note {
  id: string
  branchId: string
  throughSeq: number
  sourceSeqs: number[]
  generation: number
  text: string
  createdAt: number
  invalidatedAt?: number
  invalidatedReason?: string
}
export interface StorySnapshot {
  root: string
  revision: number
  frame: Frame
  ledgerLength: number
  notes: number
}

export async function storyCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const port = await runtimeClient()
  return port.request<T>(`modules/${STORY_MODULE}/${method}`, params)
}

/** Whether the Runtime loaded the story module and it is alive. */
export async function storyAvailable(): Promise<boolean> {
  const port = await runtimeClient()
  const modules = await port.request<Array<{ name: string; alive: boolean }>>("modules")
  return modules.some(module => module.name === STORY_MODULE && module.alive)
}

/** Module `changed` events: `{type:"changed", root, revision, what}`. */
export async function onStoryChanged(
  handler: (event: { root: string; revision: number; what: string }) => void
): Promise<() => void> {
  const port = await runtimeClient()
  return port.onModuleEvent(STORY_MODULE, event => {
    if (event.type === "changed") handler(event as unknown as { root: string; revision: number; what: string })
  })
}

/** Frame text ⇄ sections: one section per `## key` heading; text before the first heading is `world`. */
export function parseFrame(text: string): FrameSection[] {
  const sections: FrameSection[] = []
  let key = "world"
  let lines: string[] = []
  const flush = () => {
    const body = lines.join("\n").trim()
    if (body.length > 0) sections.push({ key, text: body })
    lines = []
  }
  for (const line of text.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading === null) {
      lines.push(line)
      continue
    }
    flush()
    key = heading[1] ?? key
  }
  flush()
  return sections
}

export function renderFrame(frame: Frame): string {
  return frame.sections.map(section => `## ${section.key}\n${section.text}`).join("\n\n")
}

export interface StoryAgent {
  agent: Agent
  sessionId: string
}

/**
 * Ask the module for the launch (it injects its endpoint, the story root and the bundled dsh preset),
 * start the agent as this app's own, do the ACP handshake, and open one session rooted at the story.
 * Runtime agents belong to the connection that started them, so the app drives it, not the module.
 */
export async function startStoryAgent(root: string): Promise<StoryAgent> {
  const port = await runtimeClient()
  const { launch } = await storyCall<{ launch: unknown }>("agent/launch", {
    root,
    launch: {
      engine: "dsh",
      cwd: root,
      // The demo grants nothing: read-only sandbox, and every permission request is rejected in the page.
      env: { ALWITH_DSH_WORKSPACE_ROOT: root, ALWITH_DSH_PERMISSION_MODE: "read-only" }
    }
  })
  const agentId = `story-${crypto.randomUUID()}`
  await port.start(agentId, launch as never)
  const initialized = await port.acpRequest(agentId, "initialize", {
    protocolVersion: 2,
    info: { name: "alwith-u-story", version: "0.1.0" },
    capabilities: {}
  })
  const agent = new Agent(port, agentId, "dsh", initialized)
  await agent.listen()
  const { sessionId } = await agent.request<{ sessionId: string }>("session/new", { cwd: root, mcpServers: [] })
  return { agent, sessionId }
}

/** The text of one `session/update` frame for the transcript, or null when it carries none. */
export function transcriptLine(update: SessionUpdate): { kind: "prose" | "tool"; text: string } | null {
  if (SessionUpdate.isAgentMessageChunk(update)) {
    return ContentBlock.isText(update.content) ? { kind: "prose", text: update.content.text } : null
  }
  if (SessionUpdate.isToolCallUpdate(update) && update.title != null) {
    return { kind: "tool", text: update.title }
  }
  return null
}
