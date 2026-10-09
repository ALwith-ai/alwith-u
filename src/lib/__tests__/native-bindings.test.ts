import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, expect, test } from "vitest"
import { commands, events } from "../../bindings"

afterEach(clearMocks)

test("generated runtime commands preserve SDK names, argument casing and null results", async () => {
  const calls: Array<{ command: string; args: unknown }> = []
  mockIPC((command, args) => {
    calls.push({ command, args })
    return null
  })
  expect(await commands.runtimeStart({ connectionId: "owner" })).toBeNull()
  const line = JSON.stringify({ id: 1, method: "ping" })
  expect(await commands.runtimeSend({ connectionId: "owner", line })).toBeNull()
  expect(calls).toEqual([
    { command: "runtime_start", args: { connectionId: "owner" } },
    { command: "runtime_send", args: { connectionId: "owner", line } }
  ])
  expect(events["runtime:lines"].name).toBe("runtime:lines")
  expect(events["runtime:exit"].name).toBe("runtime:exit")
})

test("generated commands preserve rejected native errors", async () => {
  const failure = { kind: "connection_replaced", message: "Window connection replaced" }
  mockIPC(() => {
    throw failure
  })
  await expect(commands.runtimeSend({ connectionId: "stale", line: "{}" })).rejects.toEqual(failure)
})

test("generated provider and updater bindings keep optional inputs and existing results", async () => {
  const calls: Array<{ command: string; args: unknown }> = []
  const snapshot = {
    revision: 1,
    appliedRevision: null,
    providers: {},
    customProviders: [],
    status: "pending",
    error: null
  }
  mockIPC((command, args) => {
    calls.push({ command, args })
    return command === "providers_save" ? snapshot : { type: "idle" }
  })
  expect(await commands.providersSave({ providerId: "qwen", input: { apiKey: "test" }, expectedRevision: 0 })).toEqual(
    snapshot
  )
  expect(await commands.updaterGetState()).toEqual({ type: "idle" })
  expect(calls[0]).toEqual({
    command: "providers_save",
    args: { providerId: "qwen", input: { apiKey: "test" }, expectedRevision: 0 }
  })
})
