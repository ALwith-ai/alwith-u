import { configureVibemon, createSpriteConfig, VibemonEngine, type VibemonHost } from "@alwith/module-auth/pets/core"
import { afterEach, expect, test, vi } from "vitest"

let engine: VibemonEngine | undefined
let dispose = () => {}
afterEach(() => {
  engine?.destroy()
  dispose()
  vi.useRealTimers()
})
function fixture() {
  vi.useFakeTimers()
  const frames: string[] = []
  const config = createSpriteConfig("pet", "sheet.png", {
    frameWidth: 64,
    frameHeight: 64,
    states: ["empty", "working", "done", "wait", "error", "hover", "drag"].map((id, row) => ({ id, row, frames: 7 }))
  })
  config.behaviorMap.sleep = "sleep"
  engine = new VibemonEngine(
    config,
    (state) => frames.push(state),
    () => {}
  )
  return { engine, frames }
}
test("celebration interrupts a pending approval and returns to it after one animation", () => {
  const { engine, frames } = fixture()
  engine.setSessionState("tasks", "requires_action", false)
  engine.celebrate()
  expect(frames.at(-1)).toBe("done")
  engine.setSessionState("tasks", "running", false)
  engine.setSessionState("tasks", "requires_action", false)
  expect(frames.at(-1)).toBe("done")
  vi.advanceTimersByTime(1000)
  expect(frames.at(-1)).toBe("wait")
  vi.advanceTimersByTime(60_000)
  expect(frames.at(-1)).toBe("wait")
})
test("simultaneous completions play once each and idle lasts a full minute after celebration", () => {
  const { engine, frames } = fixture()
  engine.setSessionState("tasks", "idle", false)
  engine.celebrate()
  engine.celebrate()
  vi.advanceTimersByTime(2000)
  expect(frames.filter((state) => state === "done")).toHaveLength(2)
  expect(frames.at(-1)).toBe("empty")
  vi.advanceTimersByTime(59_999)
  expect(frames.at(-1)).toBe("empty")
  vi.advanceTimersByTime(1)
  expect(frames.at(-1)).toBe("sleep")
})
test("hover interrupts celebration without replaying it and retains updated pending state", () => {
  const { engine, frames } = fixture()
  engine.setSessionState("tasks", "running", false)
  engine.celebrate()
  engine.hover(true)
  expect(frames.at(-1)).toBe("hover")
  engine.setSessionState("tasks", "requires_action", false)
  engine.hover(false)
  expect(frames.at(-1)).toBe("wait")
  vi.advanceTimersByTime(2000)
  expect(frames.at(-1)).toBe("wait")
  expect(frames.filter((state) => state === "done")).toHaveLength(1)
})

test("drag interrupts celebration and resumes the latest task state without replaying completion", async () => {
  dispose = configureVibemon({
    account: () => null,
    assets: {} as VibemonHost["assets"],
    storage: { get: async () => undefined, set: async () => {} },
    subscribeStorage: () => () => {},
    sessions: {
      snapshot: () => null,
      subscribe: () => () => {},
      send: async () => {},
      answer: async () => {},
      openChat: async () => {},
      activate: async () => {},
      select: async () => {}
    },
    windows: {
      call: async <T>(action: string): Promise<T> => {
        expect(action).toBe("position")
        return { x: 0, y: 0 } as T
      },
      geometry: async () => () => {},
      moved: async () => () => {},
      commands: () => () => {},
      openPet: async () => "shown",
      closePet: async () => {},
      openRecharge: async () => {}
    },
    onError: (error: unknown) => {
      throw error
    }
  })
  const { engine, frames } = fixture()
  engine.setSessionState("tasks", "running", false)
  engine.celebrate()
  engine.handleDragStart()
  expect(frames.at(-1)).toBe("drag")
  engine.setSessionState("tasks", "requires_action", false)
  expect(frames.at(-1)).toBe("drag")
  engine.handleDragEnd()
  await Promise.resolve()
  expect(frames.at(-1)).toBe("wait")
  vi.advanceTimersByTime(60_000)
  expect(frames.at(-1)).toBe("wait")
  expect(frames.filter((state) => state === "done")).toHaveLength(1)
})

test("hidden pets do not celebrate or resume a historical completion when presented again", () => {
  const { engine, frames } = fixture()
  engine.setSessionState("tasks", "running", false)
  engine.suspend()
  engine.setSessionState("tasks", "idle", false)
  engine.celebrate()
  engine.resume()
  expect(frames.at(-1)).toBe("empty")
  expect(frames).not.toContain("done")
  vi.advanceTimersByTime(60_000)
  expect(frames.at(-1)).toBe("sleep")
})
