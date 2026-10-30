import {
  createPetAssets,
  type GachaPoolDetailResponse,
  type GachaPoolSummary,
  type PetAssetsHost
} from "@alwith/module-auth/pets"
import { configureVibemon, initializeSettings, type VibemonHost } from "@alwith/module-auth/pets/core"
import { PetCenter } from "@alwith/module-auth/pets/react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

let disposeHost = () => {}
let disposeSettings = () => {}
afterEach(() => {
  cleanup()
  disposeSettings()
  disposeHost()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test("cached entry waits for Wish images once and preserves server ordering", async () => {
  const summaries: GachaPoolSummary[] = [
    { uuid: "v4", name: "v4", sort_order: 3, is_default: 0 },
    { uuid: "v3", name: "v3", sort_order: 4, is_default: 1 },
    { uuid: "v2", name: "v2", sort_order: 1, is_default: 0 },
    { uuid: "v1", name: "v1", sort_order: 2, is_default: 0 }
  ].map((pool) => ({
    banner_url: null,
    single_cost: 160,
    multi_count: 10,
    multi_cost: 1600,
    currency_type: "points",
    start_time: null,
    end_time: null,
    status: 1,
    ...pool
  }))
  const details = new Map(
    summaries.map((pool) => [
      pool.uuid,
      {
        ...pool,
        description: null,
        rates: [],
        first_draw_discount: false,
        guarantee: {
          target_rarity_code: "SSR",
          target_rarity_name: "SSR",
          hard_pity_count: 50,
          soft_pity_start: 40,
          ten_pull_min_rarity_name: "SR"
        },
        items: [
          {
            uuid: `${pool.uuid}-item`,
            pool_uuid: pool.uuid,
            vibemon_uuid: pool.uuid,
            vibemon_name: pool.name,
            vibemon_resource_url: `https://cdn.test/${pool.uuid}.zip`,
            vibemon_cover_url: "",
            vibemon_icon_url: null,
            vibemon_background_url: null,
            vibemon_pool_card_url: null,
            vibemon_sidebar_selected_url: null,
            vibemon_sidebar_hover_url: null,
            vibemon_sidebar_unselected_url: null,
            rarity_uuid: "ssr",
            rarity_code: "SSR",
            rarity_name: "SSR",
            reward_type: "VIBEMON",
            exchange_points: null,
            weight: 100,
            is_up: 0,
            status: 1,
            created_time: "",
            updated_time: ""
          }
        ]
      } satisfies GachaPoolDetailResponse
    ])
  )
  const storage = {
    get: <T,>(key: string) => Promise.resolve((key === "vibemon.introSeen" ? { "api.test/user": true } : {}) as T),
    set: vi.fn(() => Promise.resolve())
  }
  const request = vi.fn((path: string) => {
    if (path === "/api/v1/gacha/pools") return Promise.resolve(summaries)
    if (path.startsWith("/api/v1/gacha/pools/")) return Promise.resolve(details.get(path.split("/").at(-1)!))
    if (path.startsWith("/api/v1/vibemons/mine")) return Promise.resolve([])
    if (path.includes("first-draw")) return Promise.resolve({ first_draw: false })
    if (path.includes("points")) return Promise.resolve({ available_points: 100 })
    throw new Error(`Unexpected request: ${path}`)
  })
  const assets = createPetAssets({
    account: () => ({ apiHost: "api.test", userId: "user", revision: 1 }),
    storage,
    request: request as PetAssetsHost["request"],
    download: vi.fn(() => Promise.reject(new Error("Unexpected download"))),
    resources: {
      exists: () => Promise.resolve(false),
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      replace: () => Promise.resolve(),
      remove: () => Promise.resolve()
    }
  })
  const resolve = vi.spyOn(assets, "resolveImages").mockImplementation((id) =>
    Promise.resolve({
      background_url: `https://local.test/${id}/background.png`,
      pool_card_url: `https://local.test/${id}/card.png`
    })
  )
  disposeHost = configureVibemon({
    account: () => ({ apiHost: "api.test", userId: "user", revision: 1 }),
    assets,
    storage,
    subscribeStorage: () => () => {},
    sessions: {} as VibemonHost["sessions"],
    windows: {} as VibemonHost["windows"],
    onError: (error) => {
      throw error
    }
  })
  disposeSettings = await initializeSettings()
  let releaseBackground!: () => void
  const background = new Promise<void>((resolve) => {
    releaseBackground = resolve
  })
  const decode = vi.fn(function (this: { src: string }) {
    return this.src === "https://local.test/v3/background.png" ? background : Promise.resolve()
  })
  vi.stubGlobal(
    "Image",
    class {
      src = ""
      decode = decode
    }
  )
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id)
  })
  let time = performance.now()
  const advanceFrames = () =>
    act(() => {
      for (let index = 0; index < 30; index++) {
        time += 100
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach((callback) => callback(time))
      }
    })
  render(<PetCenter />)
  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(4))
  await waitFor(() =>
    expect(decode.mock.contexts.some((image) => image.src === "https://local.test/v3/background.png")).toBe(true)
  )
  advanceFrames()
  expect(screen.getByRole("progressbar")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Wish" })).not.toBeInTheDocument()
  await act(async () => {
    releaseBackground()
    await background
  })
  advanceFrames()
  fireEvent.click(await screen.findByRole("button", { name: "Wish" }))
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  expect(screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label"))).toEqual(["v2", "v1", "v4", "v3"])
  expect(screen.getByRole("tab", { name: "v2" })).toHaveAttribute("aria-selected", "true")
  expect(resolve).toHaveBeenCalledWith("v3", "https://cdn.test/v3.zip")
  fireEvent.click(screen.getByRole("button", { name: "Back" }))
  fireEvent.click(screen.getByRole("button", { name: "Wish" }))
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  expect(resolve).toHaveBeenCalledTimes(4)
  assets.dispose()
})
