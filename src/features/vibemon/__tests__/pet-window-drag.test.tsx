import { createPetAssets, type PetAssetsHost } from "@alwith/module-auth/pets"
import {
  configureVibemon,
  initializeSettings,
  type PetObservation,
  type VibemonHost
} from "@alwith/module-auth/pets/core"
import { PetWindow } from "@alwith/module-auth/pets/react"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

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

test("the packaged pet preserves drag animation and resumes its renderer after closing", async () => {
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
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pet")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  const account = { apiHost: "api.test", userId: "account", revision: 1 }
  const storage = {
    get<T>(key: string): Promise<T | undefined> {
      return Promise.resolve(
        (key === "vibemon.accounts"
          ? { "api.test/account": { pet: "pet", enabled: true, position: { x: 100, y: 100 } } }
          : undefined) as T | undefined
      )
    },
    set: vi.fn(async () => {})
  }
  const encoder = new TextEncoder()
  const files = new Map([
    [
      "vibemon/catalog/api.test/pet/resource.json",
      encoder.encode(
        JSON.stringify({
          version: 1,
          sheet: "sprite-sheet.png",
          layout: {
            frameWidth: 64,
            frameHeight: 64,
            states: [
              { id: "empty", row: 0, frames: 4 },
              { id: "drag", row: 3, frames: 8 }
            ]
          }
        })
      )
    ],
    ["vibemon/catalog/api.test/pet/sprite-sheet.png", new Uint8Array([137, 80])]
  ])
  const assetsHost: PetAssetsHost = {
    account: () => account,
    storage,
    request: () => {
      return Promise.try(() => {
        throw new Error("Cached pet must not request the server")
      })
    },
    download: () => {
      return Promise.try(() => {
        throw new Error("Cached pet must not download")
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
  let observation: PetObservation | null = null
  let observe: ((value: PetObservation | null) => void) | undefined
  const host: VibemonHost = {
    account: () => account,
    assets: createPetAssets(assetsHost),
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
        return Promise.resolve(stop)
      },
      commands: (listener) => {
        onCommand = listener
        return () => {
          onCommand = undefined
        }
      },
      geometry: () => Promise.resolve(() => {}),
      openPet: () => Promise.resolve("shown"),
      closePet: vi.fn(),
      openRecharge: vi.fn()
    },
    onError: errors
  }
  disposeHost = configureVibemon(host)
  disposeSettings = await initializeSettings()
  const view = render(<PetWindow />)
  await act(async () => {})
  expect(images).toHaveLength(1)
  await act(() => Promise.try(() => images[0].onload?.()))
  const canvas = view.container.querySelector("canvas")
  if (canvas === null) throw new Error("The pet canvas did not render")
  const sprite = canvas.parentElement
  if (sprite === null) throw new Error("The pet sprite container is missing")
  const initialTransform = sprite.style.transform
  expect(initialTransform).toBe("translateY(-36px)")
  drawImage.mockClear()
  fireEvent.pointerDown(canvas, { button: 0, screenX: 100, screenY: 100 })
  await act(async () => {
    fireEvent.pointerMove(canvas, { screenX: 110, screenY: 100 })
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
  if (onCommand === undefined) throw new Error("Pet command listener missing")
  const command = onCommand
  let closed!: Promise<void>
  await act(async () => {
    closed = command({ type: "close", petId: "pet", requestId: "close" })
    await vi.advanceTimersByTimeAsync(500)
    await closed
  })
  expect(nativeActions).toContain("hide")
  const framesWhileHidden = drawImage.mock.calls.length
  await act(() => Promise.try(() => vi.advanceTimersByTime(500)))
  expect(drawImage).toHaveBeenCalledTimes(framesWhileHidden)
  let presented!: Promise<void>
  await act(async () => {
    presented = command({ type: "present", petId: "pet", requestId: "present" })
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
    await presented
  })
  expect(nativeActions).toContain("present")
  expect(images).toHaveLength(1)
  expect(drawImage.mock.calls.length).toBeGreaterThan(framesWhileHidden)
  expect(errors).not.toHaveBeenCalled()
  const task: PetObservation = {
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
    await act(async () => {
      observe?.(observation)
    })
    expect(sprite.style.transform).toBe(initialTransform)
  }
  await publish("expanded")
  expect(bubbleVisibility.at(-1)).toBe(true)
  expect(bubbleFocus.at(-1)).toBe(false)
  await publish("expanded")
  expect(bubbleFocus.at(-1)).toBe(false)
  await publish("hidden")
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
  for (const value of [
    { ...task, taskFeed: { tasks: [{ ...task, hidden: true }], panel: "expanded" as const, mainMinimized: false } },
    { ...task, taskFeed: { tasks: [], panel: "hidden" as const, mainMinimized: false } },
    null
  ]) {
    observation = value
    await act(async () => observe?.(observation))
    expect(sprite.style.transform).toBe(initialTransform)
    expect(view.queryByRole("button", { name: /tasks/i })).toBeNull()
  }
})
