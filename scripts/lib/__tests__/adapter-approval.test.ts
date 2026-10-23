import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

// Exercise the installed adapter in process without starting Codex or reading credentials.
const bundle = readFileSync(
  new URL("../../../node_modules/@nyssance/codex-acp-v2/dist/index.js", import.meta.url),
  "utf8"
)
function section(start: string, end: string): string {
  const offset = bundle.indexOf(start)
  const finish = bundle.indexOf(end, offset)
  if (offset < 0 || finish < 0) throw new Error(`Adapter section missing: ${start}`)
  return bundle.slice(offset, finish)
}
interface Mode {
  id: string
  approvalPolicy: string
  approvalsReviewer: string
  sandboxPolicy: Record<string, unknown>
}
interface Session {
  sessionId: string
  agentMode: Mode
  additionalDirectories: string[]
}
const adapter = new Function(
  "RequestError",
  `${section("var MODE_CONFIG_ID =", "// src/alwith/hostSession.ts")}
   ${section("function addAdditionalDirectoriesToSandboxPolicy(", "\nfunction arraysEqual(")}
   class Client { constructor(codexClient) { this.codexClient = codexClient; }
     ${section("  async setAgentMode(", "  async setCollaborationMode(")}
   }
   class Server {
     constructor(client) { this.codexAcpClient = client; }
     runWithProcessCheck(work) { return work(); }
     ${section("  async applyModeChange(", "  async applyCollaborationModeChange(")}
   }
   return { AgentMode, Client, Server };`
)({ invalidParams: () => new Error("Invalid mode") }) as {
  AgentMode: {
    find(id: string): Mode
    fromThread(thread: { approvalPolicy: string; approvalsReviewer: string; sandbox: { type: string } }): Mode
  }
  Client: new (client: { threadSettingsUpdate(params: unknown): Promise<void> }) => unknown
  Server: new (client: unknown) => { applyModeChange(session: Session, mode: string): Promise<void> }
}

test.each([
  ["read-only", "user", { type: "readOnly", networkAccess: false }],
  ["workspace-write", "user", { type: "workspaceWrite", writableRoots: ["/extra"], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }],
  ["agent", "auto_review", { type: "workspaceWrite", writableRoots: ["/extra"], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }]
])("choosing %s persists the reviewer and sandbox before confirming the UI mode", async (mode, reviewer, sandbox) => {
  const session: Session = {
    sessionId: "deepseek-session", agentMode: adapter.AgentMode.find("agent-full-access"), additionalDirectories: ["/extra"]
  }
  let sent: unknown
  const server = new adapter.Server(new adapter.Client({ threadSettingsUpdate: async (params) => {
    expect(session.agentMode.id).toBe("agent-full-access")
    sent = params
  } }))
  await server.applyModeChange(session, mode)
  expect(sent).toEqual({ threadId: session.sessionId, approvalPolicy: "on-request", approvalsReviewer: reviewer, sandboxPolicy: sandbox })
  expect(session.agentMode.id).toBe(mode)
})

test("rejected permission settings leave the confirmed mode unchanged", async () => {
  const session: Session = { sessionId: "s", agentMode: adapter.AgentMode.find("agent"), additionalDirectories: [] }
  const server = new adapter.Server(new adapter.Client({ threadSettingsUpdate: async () => { throw new Error("Settings rejected") } }))
  await expect(server.applyModeChange(session, "read-only")).rejects.toThrow("Settings rejected")
  expect(session.agentMode.id).toBe("agent")
})

test.each([
  ["user", "on-request", "workspaceWrite", "workspace-write"],
  ["user", "on-request", "readOnly", "read-only"],
  ["auto_review", "on-request", "workspaceWrite", "agent"],
  ["user", "never", "dangerFullAccess", "agent-full-access"]
])("restoring %s / %s / %s retains the persisted mode", (approvalsReviewer, approvalPolicy, sandbox, expected) => {
  expect(adapter.AgentMode.fromThread({ approvalsReviewer, approvalPolicy, sandbox: { type: sandbox } }).id).toBe(expected)
})
