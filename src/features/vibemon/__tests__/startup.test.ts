import { getVibemonState, refreshSettings } from "@alwith/module-auth/pets/core"
import { isEnabled } from "@tauri-apps/plugin-autostart"
import { beforeEach, expect, test, vi } from "vitest"
import { reportBackgroundError } from "@/lib/background-errors"
import { restorePetOnStartup, runPetRestoration } from "../startup"

vi.mock("@alwith/module-auth/pets/core", () => ({ getVibemonState: vi.fn(), refreshSettings: vi.fn() }))
vi.mock("@tauri-apps/plugin-autostart", () => ({ isEnabled: vi.fn() }))
vi.mock("@/lib/background-errors", () => ({ reportBackgroundError: vi.fn() }))
vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }))
beforeEach(() => vi.resetAllMocks())

test.each([
  [true, false, true],
  [false, true, true],
  [false, false, false]
])("restores an equipped pet with enabled=%s and login item=%s", async (enabled, autostart, expected) => {
  vi.mocked(getVibemonState).mockResolvedValue({ pet: "pet", enabled, position: null })
  vi.mocked(isEnabled).mockResolvedValue(autostart)
  const present = vi.fn()
  await restorePetOnStartup(present, () => "account")
  expect(present).toHaveBeenCalledTimes(expected ? 1 : 0)
})

test("logged out or unequipped startup never opens a pet or a setup dialog", async () => {
  const present = vi.fn()
  await restorePetOnStartup(present, () => null)
  expect(refreshSettings).not.toHaveBeenCalled()
  vi.mocked(getVibemonState).mockResolvedValue({ pet: "", enabled: true, position: null })
  await restorePetOnStartup(present, () => "account")
  expect(isEnabled).not.toHaveBeenCalled()
  expect(present).not.toHaveBeenCalled()
})

test("an account change during the login-item query cancels restoration", async () => {
  let account = "first"
  vi.mocked(getVibemonState).mockResolvedValue({ pet: "pet", enabled: false, position: null })
  vi.mocked(isEnabled).mockImplementation(async () => {
    account = "second"
    return true
  })
  const present = vi.fn()
  await restorePetOnStartup(present, () => account)
  expect(present).not.toHaveBeenCalled()
})

test("automatic restoration reports one actionable notice and retries only for the same account", async () => {
  let account = "first"
  const retry = vi.fn()
  const error = new Error("download failed")
  await runPetRestoration(
    async () => {
      throw error
    },
    () => account,
    retry
  )
  expect(reportBackgroundError).toHaveBeenCalledExactlyOnceWith("pet-startup", error, {
    message: "pet.restoreFailed",
    action: { label: "pet.retry", onClick: expect.any(Function) }
  })
  const action = vi.mocked(reportBackgroundError).mock.calls[0][2]?.action
  expect(action).toBeDefined()
  action?.onClick()
  expect(retry).toHaveBeenCalledOnce()
  account = "second"
  action?.onClick()
  expect(retry).toHaveBeenCalledOnce()
})

test("account cancellation and successful restoration do not notify", async () => {
  let account: string | null = "first"
  await runPetRestoration(
    async () => {
      account = null
      throw new Error("cancelled")
    },
    () => account,
    vi.fn()
  )
  await runPetRestoration(
    async () => {},
    () => "second",
    vi.fn()
  )
  expect(reportBackgroundError).not.toHaveBeenCalled()
})
