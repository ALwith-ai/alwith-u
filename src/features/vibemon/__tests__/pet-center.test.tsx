import { observeResourceSync, syncVibemonResources } from "@alwith/module-auth/pets/core"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { VibemonCenter } from "../pet-center"

vi.mock("@alwith/module-auth/pets/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@alwith/module-auth/pets/core")>()),
  syncVibemonResources: vi.fn(async () => {})
}))
vi.mock("@alwith/module-auth/pets/react", () => ({ PetCenter: () => <div>Pets</div> }))
vi.mock("@/features/auth/store", () => ({ usePlatformAuth: () => ({ user_uuid: "account" }) }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => {
  cleanup()
  observeResourceSync("idle")
  vi.clearAllMocks()
})

test("a background sync failure stays in the pet center with a retry action", async () => {
  observeResourceSync("error")
  render(<VibemonCenter />)
  expect(screen.getByRole("alert")).toHaveTextContent("pet.syncFailed")
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "pet.retry" })))
  expect(syncVibemonResources).toHaveBeenCalledOnce()
  act(() => observeResourceSync("checking"))
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  act(() => observeResourceSync("done"))
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})
