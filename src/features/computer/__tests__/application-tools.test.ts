import { expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({ invoke: vi.fn(), stopSession: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@alwith/module-computer/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@alwith/module-computer/commands")>()),
  commands: { stopSession: native.stopSession }
}))

import { createComputerApplicationTools } from "../application-tools"

test("computer application tools preserve the native schema and route results to the requesting session", async () => {
  const schema = { type: "object", properties: { app: { type: "string" } }, required: ["app"] }
  const observation = { content: [{ type: "text", text: "Window elements" }], structuredContent: { window_id: 123 } }
  native.invoke.mockResolvedValueOnce([{ name: "get_app_state", description: "Read app state", inputSchema: schema }])
  native.invoke.mockResolvedValueOnce(observation)
  const [tool] = await createComputerApplicationTools()
  expect(tool).toMatchObject({ name: "computer_get_app_state", inputSchema: schema })
  const args = { app: "test-app" }
  const context = {
    sessionId: "original-conversation",
    toolCallId: "observe",
    turnId: "turn",
    signal: new AbortController().signal,
    agent: {} as Parameters<typeof tool.execute>[1]["agent"]
  }
  expect(await tool.execute(args, context)).toEqual(observation)
  expect(native.invoke).toHaveBeenLastCalledWith("plugin:alwith-computer|call_application_tool", {
    sessionId: context.sessionId,
    name: "get_app_state",
    arguments: args
  })
  expect(native.stopSession).not.toHaveBeenCalled()

  native.invoke.mockRejectedValueOnce({ code: "disabled", message: "Enable computer use in Settings" })
  expect(await tool.execute(args, context)).toEqual({
    isError: true,
    content: [{ type: "text", text: "Enable computer use in Settings" }],
    structuredContent: { code: "disabled", message: "Enable computer use in Settings" }
  })
})

test("a discovery failure during resume preserves the last successful driver tool contract", async () => {
  const definition = { name: "list_apps", description: "List apps", inputSchema: { type: "object" } }
  native.invoke.mockResolvedValueOnce([definition])
  const original = await createComputerApplicationTools()
  native.invoke.mockRejectedValueOnce(new Error("catalog temporarily unavailable"))
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const customTool = {
      name: "computer_custom",
      description: "Custom tool",
      inputSchema: {},
      execute: original[0].execute
    }
    const selection = {
      cwd: "/project",
      operation: { kind: "resume" as const, sessionId: "one" },
      options: {},
      previousTools: [...original, customTool]
    }
    const resumed = await createComputerApplicationTools(selection)
    expect(resumed.map(({ name, inputSchema }) => ({ name, inputSchema }))).toEqual([
      { name: original[0].name, inputSchema: definition.inputSchema }
    ])
    native.invoke.mockResolvedValueOnce([])
    expect(await createComputerApplicationTools(selection)).toEqual([])
  } finally {
    log.mockRestore()
  }
})
