import { observeResourceSync, syncVibemonResources } from "@alwith/module-auth/vibemon/core"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { VibemonCenter } from "../vibemon-center"

vi.mock("@alwith/module-auth/vibemon/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@alwith/module-auth/vibemon/core")>()),
  syncVibemonResources: vi.fn(async () => {})
}))
vi.mock("@alwith/module-auth/vibemon/react", () => ({ VibemonCenter: () => <div>Vibemon</div> }))
vi.mock("@/features/auth/store", () => ({ usePlatformAuth: () => ({ user_uuid: "account" }) }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => {
  cleanup()
  observeResourceSync("idle")
  vi.clearAllMocks()
})

test("a background sync failure stays in the vibemon center with a retry action", async () => {
  observeResourceSync("error")
  render(<VibemonCenter />)
  expect(screen.getByRole("alert")).toHaveTextContent("vibemon.syncFailed")
  await act(() => Promise.try(() => fireEvent.click(screen.getByRole("button", { name: "vibemon.retry" }))))
  expect(syncVibemonResources).toHaveBeenCalledOnce()
  act(() => observeResourceSync("checking"))
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  act(() => observeResourceSync("done"))
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
