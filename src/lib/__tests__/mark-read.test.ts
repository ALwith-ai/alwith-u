import { afterEach, expect, test, vi } from "vitest"

import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"

import { client, markRead } from "../client"
import * as runtimeModule from "../runtime"

const original = client.state
afterEach(() => {
  client.store.setState(original, true)
  vi.restoreAllMocks()
})

test("read acknowledgement retains the displayed version while the Runtime connection is pending", async () => {
  const runtime = new FakeHubPort(() => createFakeAgent().app)
  const acknowledge = vi.spyOn(runtime, "markRead")
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof runtimeModule.runtimeClient>>>()
  vi.spyOn(runtimeModule, "runtimeClient").mockReturnValueOnce(pending.promise)
  const record = {
    sessionId: "chat",
    state: "done" as const,
    version: 1,
    reusableDraft: false,
    owner: "",
    cwd: "/tmp",
    title: "",
    since: 0,
    tasks: [],
    listeningPorts: [],
    executionId: null,
    executionRole: null,
    lastActivityAt: 0,
    interruption: null
  }
  client.applyRunStates([record])
  const reading = markRead("chat")
  client.applyRunStates([{ ...record, version: 2 }])
  pending.resolve(runtime as unknown as Awaited<ReturnType<typeof runtimeModule.runtimeClient>>)
  await reading
  expect(acknowledge).toHaveBeenCalledExactlyOnceWith("chat", 1)
  expect(client.state.runStates.chat?.version).toBe(2)
})
