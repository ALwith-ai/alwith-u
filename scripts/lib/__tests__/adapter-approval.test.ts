import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

// Run the shipped adapter's configuration logic in process, without starting Codex.
const bundle = readFileSync(
  new URL("../../../node_modules/@nyssance/codex-acp-v2/dist/index.js", import.meta.url),
  "utf8"
)
const modes = bundle.slice(
  bundle.indexOf("var MODE_CONFIG_ID ="),
  bundle.indexOf("// src/codex/remotePluginEnablement.ts")
)
const config = bundle.slice(
  bundle.indexOf("// src/agent/configOptions.ts"),
  bundle.indexOf("// src/agent/forkIndex.ts")
)
const adapter = new Function(
  "RequestError",
  `${modes}\n${config}\nreturn { applyConfigOption, findAgentMode, restoredAgentMode }`
)({ invalidParams: (_data: unknown, message: string) => new Error(message) }) as {
  applyConfigOption(
    session: { id: string; mode: { id: string }; additionalDirectories: string[] },
    codex: { threadSettingsUpdate: (params: unknown) => Promise<void> },
    request: { configId: string; value: string }
  ): Promise<void>
  findAgentMode(id: string): { id: string }
  restoredAgentMode(thread: { approvalPolicy: string; approvalsReviewer: string; sandbox: { type: string } }): {
    id: string
  }
}

test.each([
  ["read-only", "user"],
  ["agent", "auto_review"]
])("choosing %s updates Codex reviewer to %s before confirming the UI mode", async (mode, reviewer) => {
  const session = {
    id: "deepseek-session",
    mode: adapter.findAgentMode("agent-full-access"),
    additionalDirectories: ["/extra"]
  }
  let sent: unknown
  await adapter.applyConfigOption(
    session,
    {
      threadSettingsUpdate: async (params) => {
        expect(session.mode.id).toBe("agent-full-access")
        sent = params
      }
    },
    { configId: "mode", value: mode }
  )
  expect(sent).toEqual({
    threadId: "deepseek-session",
    approvalPolicy: "on-request",
    approvalsReviewer: reviewer,
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: ["/extra"],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    }
  })
  expect(session.mode.id).toBe(mode)
})

test("rejected permission settings leave the confirmed mode unchanged", async () => {
  const session = { id: "deepseek-session", mode: adapter.findAgentMode("agent"), additionalDirectories: [] }
  await expect(
    adapter.applyConfigOption(
      session,
      {
        threadSettingsUpdate: async () => {
          throw new Error("Settings rejected")
        }
      },
      { configId: "mode", value: "read-only" }
    )
  ).rejects.toThrow("Settings rejected")
  expect(session.mode.id).toBe("agent")
})

test.each([
  ["user", "on-request", "workspaceWrite", "read-only"],
  ["user", "on-request", "readOnly", "read-only"],
  ["auto_review", "on-request", "workspaceWrite", "agent"],
  ["user", "never", "dangerFullAccess", "agent-full-access"]
])(
  "restoring %s / %s / %s uses the persisted approval mode",
  (approvalsReviewer, approvalPolicy, sandbox, expected) => {
    expect(adapter.restoredAgentMode({ approvalsReviewer, approvalPolicy, sandbox: { type: sandbox } }).id).toBe(
      expected
    )
  }
)
