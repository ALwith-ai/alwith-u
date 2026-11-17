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
  markVibemonFirstVisit: vi.fn(),
  getActiveGachaPools: vi.fn(),
  getGachaPoolDetail: vi.fn(),
  drawGachaPool: vi.fn(),
  resolveImages: vi.fn()
}
const externalError = vi.fn()
let stop: (() => void) | undefined
let settings: Map<string, unknown>
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
  settings = new Map<string, unknown>([["vibemon.introSeen", { [accountKey(account)]: true }]])
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
    single_cost: 1,
    multi_cost: 10,
    start_time: null,
    end_time: null,
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

test("home enters without waiting for any business requests and reopens from decoded assets", async () => {
  assets.getMyVibemons.mockImplementation(() => new Promise(() => {}))
  assets.getActiveGachaPools.mockImplementation(() => new Promise(() => {}))
  assets.getPointAccount.mockImplementation(() => new Promise(() => {}))
  const view = render(<VibemonCenter />)
  await view.findByRole("button", { name: "Wish" })
  expect(assets.getMyVibemons).not.toHaveBeenCalled()
  expect(assets.getActiveGachaPools).not.toHaveBeenCalled()
  expect(assets.getPointAccount).not.toHaveBeenCalled()
  view.unmount()
  const reopened = render(<VibemonCenter />)
  expect(reopened.getByRole("button", { name: "Wish" })).toBeInTheDocument()
  expect(reopened.queryByRole("progressbar")).not.toBeInTheDocument()
})

test.each(["owned", "pool-list", "pool-detail"])(
  "%s failure is isolated to its page and home remains available",
  async (failure) => {
    const error = new Error("Request canceled")
    if (failure === "owned") assets.getMyVibemons.mockRejectedValueOnce(error)
    if (failure === "pool-list") assets.getActiveGachaPools.mockRejectedValueOnce(error)
    if (failure === "pool-detail") assets.getGachaPoolDetail.mockRejectedValueOnce(error)
    const view = render(
      <ErrorBoundary fallback={<p>Whole app crashed</p>}>
        <button>Chat</button>
        <VibemonCenter />
      </ErrorBoundary>
    )
    const chat = view.getByRole("button", { name: "Chat" })
    fireEvent.click(await view.findByRole("button", { name: failure === "owned" ? "Album" : "Wish" }))
    expect(await view.findByRole("alert")).toHaveTextContent("Vibémon assets are unavailable")
    expect(view.queryByText("Whole app crashed")).not.toBeInTheDocument()
    fireEvent.click(view.getByRole("button", { name: "Back" }))
    expect(view.getByRole("button", { name: "Wish" })).toBeInTheDocument()
    expect(view.getByRole("button", { name: "Chat" })).toBe(chat)
    expect(externalError).not.toHaveBeenCalled()
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
  const poolsBefore = assets.getGachaPoolDetail.mock.calls.length
  fireEvent.click(pull)
  expect(await view.findByRole("alert")).toHaveTextContent("Draw succeeded")
  expect(assets.getPointAccount.mock.calls.length).toBeGreaterThan(pointsBefore)
  expect(assets.getMyVibemons.mock.calls.length).toBeGreaterThan(ownedBefore)
  expect(assets.getGachaPoolDetail.mock.calls.length).toBeGreaterThan(poolsBefore)
  expect(assets.getActiveGachaPools).toHaveBeenCalledTimes(1)
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
  assets.getGachaPoolDetail.mockRejectedValueOnce(new Error("Catalog offline"))
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

test("hidden centers stop balance refreshes and resume when shown", async () => {
  requestVibemonView("pull")
  const view = render(<VibemonCenter active />)
  await view.findByRole("button", { name: "Pull once" })
  const before = assets.getPointAccount.mock.calls.length
  view.rerender(<VibemonCenter active={false} />)
  fireEvent.focus(window)
  expect(assets.getPointAccount).toHaveBeenCalledTimes(before)
  view.rerender(<VibemonCenter active />)
  await waitFor(() => expect(assets.getPointAccount.mock.calls.length).toBeGreaterThan(before))
})

test("an unresolved first-visit check never blocks cached home materials", async () => {
  settings.set("vibemon.introSeen", {})
  await refreshSettings()
  assets.markVibemonFirstVisit = vi.fn(() => new Promise(() => {}))
  const view = render(<VibemonCenter />)
  expect(await view.findByRole("button", { name: "Wish" })).toBeInTheDocument()
  expect(assets.getActiveGachaPools).not.toHaveBeenCalled()
})

test("persisted pools remain visible while background reconciliation is pending", async () => {
  settings.set(`vibemon.poolCatalog.${accountKey(account)}`, {
    pools: [
      {
        poolUuid: "saved",
        name: "Saved pool",
        sidebarSelectedImageUrl: "",
        sidebarHoverImageUrl: "",
        sidebarUnselectedImageUrl: "",
        pageBackgroundImageUrl: "",
        poolCardImageUrl: "",
        status: "ACTIVE",
        startsAt: null,
        endsAt: null,
        singlePrice: 1,
        multiPrice: 10,
        currencyType: "points",
        canDraw: true,
        isDefault: true
      }
    ]
  })
  assets.getActiveGachaPools.mockImplementation(() => new Promise(() => {}))
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  expect(await view.findByRole("tab", { name: "Saved pool" })).toBeInTheDocument()
  expect(view.queryByRole("progressbar")).not.toBeInTheDocument()
})

test("a late first-visit response cannot interrupt a page the user already opened", async () => {
  settings.set("vibemon.introSeen", {})
  await refreshSettings()
  let finish!: (result: { first_visit: boolean }) => void
  assets.markVibemonFirstVisit.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const view = render(<VibemonCenter />)
  fireEvent.click(await view.findByRole("button", { name: "Album" }))
  expect(await view.findByRole("button", { name: "Back" })).toBeInTheDocument()
  await act(async () => {
    finish({ first_visit: true })
    await Promise.resolve()
  })
  expect(view.getByRole("button", { name: "Back" })).toBeInTheDocument()
})

test("cached pool browsing stays visible while draws wait for background reconciliation", async () => {
  const initialSummaries = await assets.getActiveGachaPools.getMockImplementation()!()
  const initialDetail = await assets.getGachaPoolDetail.getMockImplementation()!()
  assets.getActiveGachaPools.mockResolvedValue([
    ...initialSummaries,
    { ...initialSummaries[0], uuid: "second-pool", sort_order: 1, is_default: 0 }
  ])
  assets.getGachaPoolDetail.mockImplementation(async (id: string) => ({
    ...initialDetail,
    uuid: id,
    name: id === "second-pool" ? "Second pool" : "Test pool"
  }))
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  await waitFor(() => expect(view.getByRole("button", { name: "Pull once" })).toBeEnabled())
  const summaries = await assets.getActiveGachaPools.mock.results[0].value
  let finish!: (value: unknown) => void
  assets.getActiveGachaPools.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  fireEvent.click(view.getByRole("button", { name: "Back" }))
  fireEvent.click(view.getByRole("button", { name: "Wish" }))
  await waitFor(() => expect(assets.getActiveGachaPools).toHaveBeenCalledTimes(2))
  expect(view.getByRole("tab", { name: "Test pool" })).toBeEnabled()
  const secondPool = view.getByRole("tab", { name: "Second pool" })
  expect(secondPool).toBeEnabled()
  fireEvent.click(secondPool)
  expect(secondPool).toHaveAttribute("aria-selected", "true")
  expect(view.getByRole("tab", { name: "Test pool" })).toHaveAttribute("aria-selected", "false")
  expect(view.queryByRole("progressbar")).not.toBeInTheDocument()
  const pull = view.getByRole("button", { name: "Pull once" })
  expect(pull).toBeDisabled()
  fireEvent.click(pull)
  expect(assets.drawGachaPool).not.toHaveBeenCalled()
  await act(async () => {
    finish(summaries)
    await Promise.resolve()
  })
  await waitFor(() => expect(pull).toBeEnabled())
  assets.drawGachaPool.mockResolvedValue({ results: [] })
  fireEvent.click(pull)
  expect(await view.findByRole("alert")).toHaveTextContent("Draw succeeded")
  await waitFor(() => expect(assets.getGachaPoolDetail).toHaveBeenCalledTimes(5))
  expect(assets.getActiveGachaPools).toHaveBeenCalledTimes(2)
})

test("focus during an in-flight draw does not start a competing full pool refresh", async () => {
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  await waitFor(() => expect(view.getByRole("button", { name: "Pull once" })).toBeEnabled())
  let finish!: (value: unknown) => void
  assets.drawGachaPool.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  fireEvent.click(view.getByRole("button", { name: "Pull once" }))
  await waitFor(() => expect(assets.drawGachaPool).toHaveBeenCalledTimes(1))
  expect(view.getByRole("tab", { name: "Test pool" })).toBeDisabled()
  fireEvent.focus(window)
  expect(assets.getActiveGachaPools).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish({ results: [] })
    await Promise.resolve()
  })
  expect(await view.findByRole("alert")).toHaveTextContent("Draw succeeded")
  await waitFor(() => expect(assets.getGachaPoolDetail).toHaveBeenCalledTimes(2))
  expect(assets.getActiveGachaPools).toHaveBeenCalledTimes(1)
})

test("uncached pools keep the pool frame with a content spinner and can return home", async () => {
  assets.getActiveGachaPools.mockImplementation(() => new Promise(() => {}))
  requestVibemonView("pull")
  const view = render(<VibemonCenter />)
  const loading = await view.findByTestId("vibemon-pool-loading")
  expect(view.getByRole("status", { name: "Loading…" })).toBeInTheDocument()
  expect(loading.querySelector(".animate-spin")).not.toBeNull()
  const stage = view.getByTestId("vibemon-pull-stage")
  expect(stage).toContainElement(loading)
  expect(view.getByTestId("vibemon-pool-page-background")).toBeInTheDocument()
  expect(view.getByRole("button", { name: "Album" })).toBeEnabled()
  expect(view.getByRole("button", { name: "Vibémon" })).toBeEnabled()
  expect(view.queryByRole("button", { name: "Pull once" })).not.toBeInTheDocument()
  expect(view.queryByRole("progressbar")).not.toBeInTheDocument()
  fireEvent.click(view.getByRole("button", { name: "Back" }))
  expect(view.getByRole("button", { name: "Wish" })).toBeInTheDocument()
  expect(view.queryByTestId("vibemon-pool-loading")).not.toBeInTheDocument()
})
