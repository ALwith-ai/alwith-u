import { fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ErrorBoundary } from "@/components/error-boundary"

import { VibemonCenter } from "../vibemon-center"

const state = vi.hoisted(() => ({ broken: false, account: "first" }))
vi.mock("@alwith/module-auth/vibemon/react", () => ({
  VibemonCenter: () => {
    if (state.broken) throw new Error("Unexpected Vibemon render failure")
    return <p>Vibemon content</p>
  }
}))
vi.mock("@alwith/module-auth/vibemon/core", () => ({
  resourceSyncStatus: () => "idle",
  subscribeResourceSync: () => () => {},
  syncVibemonResources: vi.fn()
}))
vi.mock("@/features/auth/store", () => ({
  usePlatformAuth: (select: (value: unknown) => unknown) => select({ user: { user_uuid: state.account } })
}))
vi.mock("@tauri-apps/plugin-log", () => ({ error: vi.fn(() => Promise.resolve()) }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@/lib/i18n", () => ({ default: { on: vi.fn(), off: vi.fn(), t: (key: string) => key } }))

beforeEach(() => {
  state.broken = true
  state.account = "first"
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

function MainWindow() {
  return (
    <ErrorBoundary fallback={<p>Entire app crashed</p>}>
      <button>Chat still works</button>
      <VibemonCenter />
    </ErrorBoundary>
  )
}

test("a renderer crash stays inside Vibemon and can be retried without remounting chat", () => {
  const view = render(<MainWindow />)
  const chat = view.getByRole("button", { name: "Chat still works" })
  expect(view.getByRole("alert")).toHaveTextContent("offline.title")
  expect(view.queryByText("Entire app crashed")).not.toBeInTheDocument()
  state.broken = false
  fireEvent.click(view.getByRole("button", { name: "offline.retry" }))
  expect(view.getByText("Vibemon content")).toBeInTheDocument()
  expect(view.getByRole("button", { name: "Chat still works" })).toBe(chat)
})

test("changing accounts resets the local crash without requiring a window reload", () => {
  const view = render(<MainWindow />)
  expect(view.getByRole("alert")).toBeInTheDocument()
  state.broken = false
  state.account = "second"
  view.rerender(<MainWindow />)
  expect(view.getByText("Vibemon content")).toBeInTheDocument()
})
