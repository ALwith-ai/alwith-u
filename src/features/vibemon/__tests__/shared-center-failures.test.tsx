import { accountKey, type VibemonAssets } from "@alwith/module-auth/vibemon"
import {
  configureVibemon,
  refreshSettings,
  requestVibemonView,
  type VibemonHost
} from "@alwith/module-auth/vibemon/core"
import { VibemonCenter } from "@alwith/module-auth/vibemon/react"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ErrorBoundary } from "@/components/error-boundary"
import { initI18n } from "@/lib/i18n"

vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn(() => Promise.resolve()) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

const account = { apiHost: "example.test", userId: "test-user", revision: 0 }
const assets = {
  getMyVibemons: vi.fn(),
  getPointAccount: vi.fn(),
  getGachaFirstDraw: vi.fn(),
  getActiveGachaPools: vi.fn(),
  getGachaPoolDetail: vi.fn(),
  drawGachaPool: vi.fn(),
  resolveImages: vi.fn()
}
const externalError = vi.fn()
let stop: (() => void) | undefined
const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode")

beforeEach(async () => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: () => Promise.resolve()
  })
  await initI18n("en")
  const settings = new Map<string, unknown>([["vibemon.introSeen", { [accountKey(account)]: true }]])
  assets.getMyVibemons.mockResolvedValue([])
  assets.getPointAccount.mockResolvedValue({ available_points: 100 })
  assets.getGachaFirstDraw.mockResolvedValue({ first_draw: false })
  assets.getActiveGachaPools.mockResolvedValue([
    { uuid: "pool", sort_order: 0, start_time: null, end_time: null, is_default: 1, single_cost: 1, multi_cost: 10 }
  ])
  assets.getGachaPoolDetail.mockResolvedValue({
    uuid: "pool",
    name: "Test pool",
    multi_count: 10,
    status: 1,
    items: [{ reward_type: "VIBEMON", vibemon_uuid: "pet", status: 1, rarity_code: "SSR" }]
  })
  assets.resolveImages.mockResolvedValue({})
  stop = configureVibemon({
    account: () => account,
    assets: assets as unknown as VibemonAssets,
    storage: {
      get: <T,>(key: string) => Promise.resolve(settings.get(key) as T | undefined),
      set: (key, value) => {
        settings.set(key, value)
        return Promise.resolve()
      }
    },
    subscribeStorage: () => () => {},
    sessions: {} as VibemonHost["sessions"],
    windows: {} as VibemonHost["windows"],
    onError: externalError
  })
  await refreshSettings()
})

afterEach(() => {
  cleanup()
  stop?.()
  vi.restoreAllMocks()
  if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode)
  else Reflect.deleteProperty(HTMLImageElement.prototype, "decode")
})

test("ready resources enter the center without waiting for any animation frame", async () => {
  vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(1)
  const cancelFrame = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {})
  let finish!: (images: Record<string, string>) => void
  assets.resolveImages.mockImplementationOnce(
    () =>
      new Promise<Record<string, string>>((resolve) => {
        finish = resolve
      })
  )
  const view = render(<VibemonCenter />)
  await waitFor(() => expect(assets.resolveImages).toHaveBeenCalled())
  expect(view.getByRole("progressbar")).toBeInTheDocument()
  expect(view.queryByRole("button", { name: "Wish" })).not.toBeInTheDocument()
  await act(() => {
    finish({})
    return Promise.resolve()
  })
  expect(view.queryByRole("progressbar")).not.toBeInTheDocument()
  expect(view.getByRole("button", { name: "Wish" })).toBeInTheDocument()
  expect(cancelFrame).toHaveBeenCalled()
})

test.each(["owned", "pool-list", "pool-detail", "resource"])(
  "%s failure stays inside the real shared center and retry restarts loading",
  async (failure) => {
    const error = new Error("Request canceled")
    if (failure === "owned") assets.getMyVibemons.mockRejectedValueOnce(error)
    if (failure === "pool-list") assets.getActiveGachaPools.mockRejectedValueOnce(error)
    if (failure === "pool-detail") assets.getGachaPoolDetail.mockRejectedValueOnce(error)
    if (failure === "resource") assets.resolveImages.mockRejectedValueOnce(error)
    const view = render(
      <ErrorBoundary fallback={<p>Whole app crashed</p>}>
        <button>Chat</button>
        <VibemonCenter />
      </ErrorBoundary>
    )
    const chat = view.getByRole("button", { name: "Chat" })
    expect(await view.findByRole("alert")).toHaveTextContent("Vibémon assets are unavailable")
    expect(view.queryByText("Whole app crashed")).not.toBeInTheDocument()
    fireEvent.click(view.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(assets.getMyVibemons).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.queryByRole("alert")).not.toBeInTheDocument())
    expect(view.getByRole("button", { name: "Chat" })).toBe(chat)
    expect(externalError).not.toHaveBeenCalled()
    const { toast } = await import("sonner")
    expect(toast.error).not.toHaveBeenCalled()
  }
)

test.each(["request", "result"])(
  "draw %s failure is local and never automatically repeats the draw",
  async (failure) => {
    if (failure === "request") assets.drawGachaPool.mockRejectedValue(new Error("Request canceled"))
    else assets.drawGachaPool.mockResolvedValue({ results: [] })
    requestVibemonView("pull")
    const view = render(
      <ErrorBoundary fallback={<p>Whole app crashed</p>}>
        <button>Chat</button>
        <VibemonCenter />
      </ErrorBoundary>
    )
    const pull = await view.findByRole("button", { name: "Pull once" }, { timeout: 5000 })
    fireEvent.click(pull)
    expect(await view.findByRole("alert")).toHaveTextContent(failure === "request" ? "Draw failed" : "Draw succeeded")
    expect(view.getByRole("button", { name: "Chat" })).toBeInTheDocument()
    expect(view.queryByText("Whole app crashed")).not.toBeInTheDocument()
    expect(assets.drawGachaPool).toHaveBeenCalledExactlyOnceWith("pool", "SINGLE")
    expect(externalError).not.toHaveBeenCalled()
    const { toast } = await import("sonner")
    expect(toast.error).not.toHaveBeenCalled()
  }
)

test.each(["resource", "decode"])("successful draws recover from %s failure without drawing again", async (failure) => {
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  const pull = await view.findByRole("button", { name: "Pull once" })
  assets.drawGachaPool.mockResolvedValue({
    results: [
      {
        reward_type: "VIBEMON",
        vibemon_uuid: "won",
        vibemon_name: "Won",
        draw_index: 0,
        rarity_code: "SSR",
        is_duplicate: false,
        gacha_url: `/won-${failure}.png`,
        multi_draw_url: `/won-${failure}-multi.png`
      }
    ]
  })
  let failResult = true
  assets.resolveImages.mockImplementation((id: string) =>
    id === "won" && failure === "resource" && failResult
      ? Promise.reject(new Error("Result image unavailable"))
      : Promise.resolve({})
  )
  if (failure === "decode")
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: function (this: HTMLImageElement) {
        return failResult && this.src.endsWith("/won-decode.png")
          ? Promise.reject(new Error("Broken image"))
          : Promise.resolve()
      }
    })
  const pointsBefore = assets.getPointAccount.mock.calls.length
  const ownedBefore = assets.getMyVibemons.mock.calls.length
  const poolsBefore = assets.getActiveGachaPools.mock.calls.length
  fireEvent.click(pull)
  expect(await view.findByRole("alert")).toHaveTextContent("Draw succeeded")
  expect(assets.getPointAccount.mock.calls.length).toBeGreaterThan(pointsBefore)
  expect(assets.getMyVibemons.mock.calls.length).toBeGreaterThan(ownedBefore)
  expect(assets.getActiveGachaPools.mock.calls.length).toBeGreaterThan(poolsBefore)
  expect(view.getByRole("button", { name: "Pull once" })).toBeDisabled()
  failResult = false
  fireEvent.click(view.getByRole("button", { name: "Reload result" }))
  await waitFor(() => expect(view.queryByRole("alert")).not.toBeInTheDocument())
  expect(assets.drawGachaPool).toHaveBeenCalledTimes(1)
  expect(view.container.querySelector('[data-presentation-state="video-waiting"]')).toBeInTheDocument()
})

test("the last pool expiring shows an empty state and can refresh an empty server catalog", async () => {
  const end = new Date(Date.now() + 60_000).toISOString()
  assets.getActiveGachaPools.mockResolvedValue([
    { uuid: "pool", sort_order: 0, start_time: null, end_time: end, is_default: 1, single_cost: 1, multi_cost: 10 }
  ])
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  await view.findByRole("button", { name: "Pull once" })
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(end) + 1)
  expect(await view.findByRole("status", {}, { timeout: 2500 })).toHaveTextContent("No card pools")
  expect(view.queryByRole("button", { name: "Pull once" })).not.toBeInTheDocument()
  expect(view.getByRole("button", { name: "Back" })).toBeEnabled()
  await waitFor(() => expect(assets.getActiveGachaPools).toHaveBeenCalledTimes(2))
  const calls = assets.getActiveGachaPools.mock.calls.length
  assets.getActiveGachaPools.mockResolvedValue([])
  fireEvent.click(view.getByRole("button", { name: "Refresh card pools" }))
  await waitFor(() => expect(assets.getActiveGachaPools).toHaveBeenCalledTimes(calls + 1))
  expect(view.getByRole("status")).toHaveTextContent("No card pools")
  expect(view.queryByRole("alert")).not.toBeInTheDocument()
})

test("failed catalog refresh preserves a successful draw and its result recovery", async () => {
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  const pull = await view.findByRole("button", { name: "Pull once" })
  assets.getActiveGachaPools.mockRejectedValueOnce(new Error("Catalog offline"))
  assets.drawGachaPool.mockResolvedValue({ results: [] })
  fireEvent.click(pull)
  expect(await view.findByRole("alert")).toHaveTextContent("Draw succeeded")
  expect(view.getByRole("button", { name: "Reload result" })).toBeEnabled()
  expect(view.getByRole("button", { name: "Refresh card pools" })).toBeEnabled()
  expect(view.getByRole("button", { name: "Pull once" })).toBeDisabled()
  fireEvent.click(view.getByRole("button", { name: "Refresh card pools" }))
  await waitFor(() => expect(view.queryByRole("button", { name: "Refresh card pools" })).not.toBeInTheDocument())
  expect(view.getByRole("button", { name: "Reload result" })).toBeEnabled()
  expect(assets.drawGachaPool).toHaveBeenCalledTimes(1)
})

test("failed inventory refresh keeps a successful draw available for result recovery", async () => {
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  const pull = await view.findByRole("button", { name: "Pull once" })
  assets.getMyVibemons.mockRejectedValueOnce(new Error("Inventory offline"))
  assets.drawGachaPool.mockResolvedValue({ results: [] })
  fireEvent.click(pull)
  expect(await view.findByRole("alert")).toHaveTextContent("Draw succeeded")
  expect(view.getByRole("button", { name: "Reload result" })).toBeEnabled()
  expect(view.getByRole("button", { name: "Pull once" })).toBeDisabled()
  expect(view.queryByText("Vibémon assets are unavailable")).not.toBeInTheDocument()
  expect(assets.drawGachaPool).toHaveBeenCalledTimes(1)
})
