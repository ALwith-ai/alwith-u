import { beforeEach, expect, test, vi } from "vitest"
const native = vi.hoisted(() => ({ computerStart: vi.fn(), computerStop: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: native }))
import { enableComputer, stopComputer } from "../operations"
beforeEach(() => vi.resetAllMocks())
test("global enable needs no session or ACP connection", async () => {
  await enableComputer()
  expect(native.computerStart).toHaveBeenCalledExactlyOnceWith()
})
test("global stop revokes native authority without cancelling conversations", async () => {
  await stopComputer()
  expect(native.computerStop).toHaveBeenCalledExactlyOnceWith()
})
test("native failures propagate", async () => {
  native.computerStart.mockRejectedValue(new Error("missing permission"))
  await expect(enableComputer()).rejects.toThrow("missing permission")
})
