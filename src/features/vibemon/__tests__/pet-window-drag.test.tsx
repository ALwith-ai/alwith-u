import { createPetAssets, type PetAssetsHost } from "@alwith/module-auth/pets"
import { configureVibemon, initializeSettings, type VibemonHost } from "@alwith/module-auth/pets/core"
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

test("the packaged pet plays successive drag frames until native release and reverses without restarting", async () => {
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
  const host: VibemonHost = {
    account: () => account,
    assets: createPetAssets(assetsHost),
    storage,
    subscribeStorage: () => () => {},
    sessions: {
      snapshot: () => null,
      subscribe: () => () => {},
      send: vi.fn(),
      answer: vi.fn(),
      openChat: vi.fn(),
      activate: vi.fn(),
      select: vi.fn()
    },
    windows: {
      async call<T>(action: string): Promise<T> {
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
      commands: () => () => {},
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
})
