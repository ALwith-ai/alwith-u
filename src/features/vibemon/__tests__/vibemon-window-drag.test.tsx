import { createVibemonAssets, type VibemonAssetsHost } from "@alwith/module-auth/vibemon"
import {
  configureVibemon,
  initializeSettings,
  type VibemonHost,
  type VibemonObservation
} from "@alwith/module-auth/vibemon/core"
import { VibemonWindow } from "@alwith/module-auth/vibemon/react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

await initI18n("en")

let disposeHost: (() => void) | undefined
let disposeSettings: (() => void) | undefined
afterEach(() => {
  cleanup()
  disposeSettings?.()
  disposeHost?.()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

test("the packaged vibemon preserves drag animation and resumes its renderer after closing", async () => {
  vi.useFakeTimers()
  const images: { onload: (() => void) | null }[] = []
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      src = ""
      constructor() {
        images.push(this)
      }
    }
  )
  vi.stubGlobal("PointerEvent", MouseEvent)
  const drawImage = vi.fn<(image: CanvasImageSource, ...coordinates: number[]) => void>()
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    drawImage,
    imageSmoothingEnabled: false
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:vibemon")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  const account = { apiHost: "api.test", userId: "account", revision: 1 }
  const storage = {
    get<T>(key: string): Promise<T | undefined> {
      return Promise.resolve(
        (key === "vibemon.accounts"
          ? { "api.test/account": { vibemon: "vibemon", enabled: true, position: { x: 100, y: 100 } } }
          : undefined) as T | undefined
      )
    },
    set: vi.fn(async () => {})
  }
  const encoder = new TextEncoder()
  const files = new Map([
    [
      "vibemon/catalog/api.test/vibemon/resource.json",
      encoder.encode(
        JSON.stringify({
          version: 1,
          sheet: "sprite-sheet.png",
          layout: {
            frameWidth: 64,
            frameHeight: 64,
            states: [
              { id: "empty", row: 0, frames: 4 },
              { id: "working", row: 1, frames: 4 },
              { id: "done", row: 2, frames: 4 },
              { id: "drag", row: 3, frames: 8 }
            ]
          }
        })
      )
    ],
    ["vibemon/catalog/api.test/vibemon/sprite-sheet.png", new Uint8Array([137, 80])]
  ])
  const assetsHost: VibemonAssetsHost = {
    account: () => account,
    storage,
    request: () => {
      return Promise.try(() => {
        throw new Error("Cached vibemon must not request the server")
      })
    },
    download: () => {
      return Promise.try(() => {
        throw new Error("Cached vibemon must not download")
      })
    },
    resources: {
      exists: (path) => Promise.try(() => files.has(path)),
      read: (path) => Promise.try(() => files.get(path) ?? null),
      write: vi.fn(),
      replace: vi.fn(),
      remove: vi.fn()
    }
  }
  const release = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const moved: { listener: ((position: { x: number; y: number }) => void) | null } = { listener: null }
  const stop = vi.fn()
  const errors = vi.fn()
  let onCommand: Parameters<VibemonHost["windows"]["commands"]>[0] | undefined
  const nativeActions: string[] = []
  const bubbleVisibility: boolean[] = []
  const bubbleFocus: boolean[] = []
  let observation: VibemonObservation | null = null
  let observe: ((value: VibemonObservation | null) => void) | undefined
  const host: VibemonHost = {
    account: () => account,
    assets: createVibemonAssets(assetsHost),
    storage,
    subscribeStorage: () => () => {},
    sessions: {
      snapshot: () => observation,
      subscribe: (listener) => {
        observe = listener
        return () => {
          observe = undefined
        }
      },
      send: vi.fn(),
      answer: vi.fn(),
      openChat: vi.fn(),
      activate: vi.fn(),
      select: vi.fn(),
      panel: vi.fn(async () => {})
    },
    windows: {
      async call<T>(action: string, payload?: Record<string, unknown>): Promise<T> {
        nativeActions.push(action)
        if (action === "bubble") {
          bubbleVisibility.push(payload?.visible === true)
          bubbleFocus.push(payload?.focus === true)
        }
        if (action === "drag") {
          started.resolve()
          await release.promise
        }
        const responses: Record<string, unknown> = {
          monitors: [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 }],
          position: { x: 100, y: 100 },
          size: { width: 200, height: 200 },
          scale: 1
        }
        return responses[action] as T
      },
      moved: (listener) => {
        moved.listener = listener
        return started.promise.then(() => stop)
      },
      commands: (listener) => {
        onCommand = listener
        return () => {
          onCommand = undefined
        }
      },
      geometry: () => Promise.resolve(() => {}),
      openVibemon: () => Promise.resolve("shown"),
      closeVibemon: vi.fn(),
      openRecharge: vi.fn()
    },
    onError: errors
  }
  disposeHost = configureVibemon(host)
  disposeSettings = await initializeSettings()
  const view = render(<VibemonWindow />)
  await act(async () => {})
  expect(images).toHaveLength(1)
  await act(() => Promise.try(() => images[0].onload?.()))
  const canvas = view.container.querySelector("canvas")
  if (canvas === null) throw new Error("The vibemon canvas did not render")
  const sprite = canvas.parentElement
  if (sprite === null) throw new Error("The vibemon sprite container is missing")
  const initialTransform = sprite.style.transform
  expect(initialTransform).toBe("")
  drawImage.mockClear()
  fireEvent.pointerDown(canvas, { button: 0, screenX: 100, screenY: 100 })
  await act(async () => {
    fireEvent.pointerMove(canvas, { buttons: 1, screenX: 110, screenY: 100 })
    await started.promise
  })
  expect(drawImage.mock.calls.at(-1)?.slice(1, 3)).toEqual([0, 192])
  await act(() => Promise.try(() => vi.advanceTimersByTime(300)))
  expect(drawImage.mock.calls.map((call) => call.slice(1, 3))).toEqual([
    [0, 192],
    [64, 192],
    [128, 192]
  ])
  await act(() => Promise.try(() => moved.listener?.({ x: 80, y: 100 })))
  expect(canvas.style.transform).toBe("scaleX(-1)")
  await act(() => Promise.try(() => vi.advanceTimersByTime(150)))
  expect(drawImage.mock.calls.at(-1)?.slice(1, 3)).toEqual([192, 192])
  expect(stop).not.toHaveBeenCalled()
  await act(() => Promise.try(() => release.resolve()))
  expect(drawImage.mock.calls.at(-1)?.slice(1, 3)).toEqual([0, 0])
  expect(stop).toHaveBeenCalledOnce()
  expect(errors).not.toHaveBeenCalled()
  if (onCommand === undefined) throw new Error("Vibemon command listener missing")
  const command = onCommand
  let closed!: Promise<void>
  const hidesBeforeReturn = nativeActions.filter((action) => action === "hide").length
  await act(async () => {
    closed = command({ type: "close", vibemonId: "vibemon", requestId: "close" })
    await vi.advanceTimersByTimeAsync(469)
  })
  expect(sprite).toHaveStyle({ visibility: "hidden" })
  expect(view.container.querySelector(".alwith-vibemon-burst")).toBeInTheDocument()
  expect(nativeActions).toContain("sound")
  expect(nativeActions.filter((action) => action === "hide")).toHaveLength(hidesBeforeReturn)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
    await closed
  })
  expect(nativeActions).toContain("hide")
  // Keep the retained native renderer masked until an explicit presentation prepares a fresh frame.
  expect(sprite).toHaveStyle({ visibility: "hidden" })
  const framesWhileHidden = drawImage.mock.calls.length
  await act(() => Promise.try(() => vi.advanceTimersByTime(500)))
  expect(drawImage).toHaveBeenCalledTimes(framesWhileHidden)
  expect(sprite).toHaveStyle({ visibility: "hidden" })
  let presented!: Promise<void>
  await act(async () => {
    presented = command({ type: "present", vibemonId: "vibemon", requestId: "present" })
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
    await presented
  })
  expect(nativeActions).toContain("present")
  expect(sprite).toHaveStyle({ visibility: "visible" })
  expect(images).toHaveLength(1)
  expect(drawImage.mock.calls.length).toBeGreaterThan(framesWhileHidden)
  expect(errors).not.toHaveBeenCalled()
  const task: VibemonObservation = {
    binding: { connectionEpoch: "epoch", agentId: "codex", sessionId: "one", incarnation: "one", bindingRevision: 1 },
    source: "event",
    revision: 1,
    state: "done",
    since: 0,
    title: "Task",
    cwd: "/project",
    windowLabel: "main",
    candidates: [],
    owner: "owner",
    executionId: null,
    executionRole: null,
    access: "writable",
    surfaceVisible: false,
    error: null,
    reply: null,
    userMessage: null,
    prompt: null
  }
  const publish = async (panel: "expanded" | "hidden") => {
    observation = { ...task, taskFeed: { tasks: [task], panel, mainMinimized: false } }
    await act(() => {
      observe?.(observation)
      return Promise.resolve()
    })
    expect(sprite.style.transform).toBe(initialTransform)
  }
  await publish("expanded")
  expect(bubbleVisibility.at(-1)).toBe(true)
  const collapse = view.getByRole("button", { name: "Collapse tasks" })
  expect(collapse.querySelector(".lucide-chevron-down")).not.toBeNull()
  expect(collapse).not.toHaveTextContent("↑")
  expect(bubbleFocus.at(-1)).toBe(false)
  await publish("expanded")
  expect(bubbleFocus.at(-1)).toBe(false)
  await publish("hidden")
  const expand = view.getByRole("button", { name: "Expand tasks" })
  expect(expand.querySelector(".lucide-bell")).toBeInTheDocument()
  expect(expand.querySelector(".vibemon-task-count")).toHaveTextContent("1")
  expect(expand).toHaveAttribute("data-tone", "completed")
  expect(bubbleVisibility.at(-1)).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120)
  })
  await publish("expanded")
  expect(bubbleFocus.at(-1)).toBe(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  expect(bubbleVisibility.at(-1)).toBe(true)
  await publish("hidden")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(240)
  })
  expect(bubbleVisibility.at(-1)).toBe(false)
  const surface = view.container.querySelector("[data-vibemon-animation]")
  const background = {
    ...task,
    binding: { ...task.binding, sessionId: "background" },
    state: "running" as const,
    hidden: true
  }
  observation = { ...task, taskFeed: { tasks: [task, background], panel: "hidden", mainMinimized: false } }
  await act(() => Promise.resolve(observe?.(observation)))
  expect(surface).toHaveAttribute("data-vibemon-animation", "working")
  observation = { ...background, taskFeed: observation.taskFeed }
  await act(() => Promise.resolve(observe?.(observation)))
  expect(surface).toHaveAttribute("data-vibemon-animation", "working")
  const completed = { ...background, state: "done" as const, hidden: false, completion: "new-turn" }
  observation = { ...task, taskFeed: { tasks: [task, completed], panel: "hidden", mainMinimized: false } }
  await act(() => Promise.resolve(observe?.(observation)))
  expect(surface).toHaveAttribute("data-vibemon-animation", "done")
  await act(async () => vi.advanceTimersByTimeAsync(1000))
  expect(surface).toHaveAttribute("data-vibemon-animation", "empty")
  for (const value of [
    { ...task, taskFeed: { tasks: [{ ...task, hidden: true }], panel: "expanded" as const, mainMinimized: false } },
    { ...task, taskFeed: { tasks: [], panel: "hidden" as const, mainMinimized: false } },
    null
  ]) {
    observation = value
    await act(() => Promise.resolve(observe?.(observation)))
    expect(sprite.style.transform).toBe(initialTransform)
    expect(view.queryByRole("button", { name: /tasks/i })).toBeNull()
  }
})
