import { createSession, type SessionRunState } from "@alwith/api"
import { expect, test, vi } from "vitest"
import { CodexClient } from "@/agent/client"
import { createGamepadConfigGenerator } from "../ai-host"

function harness() {
  // No connection is opened: the host's transport boundary is controlled in-process.
  const client = new CodexClient(
    async () => {
      throw new Error("Unexpected transport access")
    },
    {
      agentId: "gamepad-test",
      launch: { engine: "codex" }
    }
  )
  const session = createSession("generated", "/workspace")
  session.attached = true
  const connect = vi.spyOn(client, "connect").mockImplementation(async () => {
    client.store.setState({ connection: "ready", sessions: { generated: session } })
  })
  vi.spyOn(client, "newSession").mockResolvedValue("generated")
  const prompt = vi.spyOn(client, "prompt").mockResolvedValue()
  const cancel = vi.spyOn(client, "cancel").mockResolvedValue()
  const close = vi.spyOn(client, "close").mockResolvedValue()
  const dispose = vi.fn(async () => {})
  const generate = createGamepadConfigGenerator(async () => ({
    client,
    cwd: "/workspace",
    model: "gpt-test",
    platform: "macos",
    dispose
  }))
  const config = { buttons: {}, left_stick: {}, right_stick: {} } as Parameters<typeof generate>[1]
  const finish = (text: string, done = true): void => {
    client.store.setState({
      sessions: {
        generated: {
          ...session,
          lastStopReason: "end_turn",
          items: [
            {
              id: "reply",
              kind: "assistant",
              at: 1,
              replayed: false,
              _meta: null,
              echo: null,
              content: [{ type: "text", text }]
            }
          ]
        }
      },
      runStates: done ? { generated: { sessionId: "generated", state: "done" } as SessionRunState } : {}
    })
  }
  return { client, connect, prompt, cancel, close, dispose, generate, config, finish }
}

test("acceptance does not complete generation; only the explicit session's Runtime completion does", async () => {
  const h = harness()
  const progress = vi.fn()
  let settled = false
  const result = h.generate("copy", h.config, new AbortController().signal, progress).then(value => {
    settled = true
    return value
  })
  await vi.waitFor(() => expect(h.prompt).toHaveBeenCalled())
  h.finish('{"buttons":{"south":{"to":[{"key_code":"KeyC"}]}}}', false)
  await Promise.resolve()
  expect(settled).toBe(false)
  h.client.store.setState({ runStates: { unrelated: { sessionId: "unrelated", state: "done" } as SessionRunState } })
  await Promise.resolve()
  expect(settled).toBe(false)
  h.finish('{"buttons":{"south":{"to":[{"key_code":"KeyC"}]}}}')
  expect(await result).toMatchObject({ buttons: { south: { to: [{ key_code: "KeyC" }] } } })
  expect(progress).toHaveBeenCalled()
  expect(h.cancel).toHaveBeenCalledWith("generated")
  expect(h.close).toHaveBeenCalledWith("generated")
  expect(h.dispose).toHaveBeenCalledOnce()
})

test("abort cancels and closes the isolated session", async () => {
  const h = harness()
  const controller = new AbortController()
  const result = h.generate("copy", h.config, controller.signal)
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" })
  await vi.waitFor(() => expect(h.prompt).toHaveBeenCalled())
  controller.abort()
  await rejected
  expect(h.cancel).toHaveBeenCalledWith("generated")
  expect(h.close).toHaveBeenCalledWith("generated")
  expect(h.dispose).toHaveBeenCalledOnce()
})

test("malformed model output fails and still disposes its session", async () => {
  const h = harness()
  const result = h.generate("copy", h.config, new AbortController().signal)
  const rejected = expect(result).rejects.toThrow()
  await vi.waitFor(() => expect(h.prompt).toHaveBeenCalled())
  h.finish("not JSON")
  await rejected
  expect(h.dispose).toHaveBeenCalledOnce()
})
