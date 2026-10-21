import { getVibemonState, refreshSettings } from "@alwith/module-auth/pets/core"
import { beforeEach, expect, test, vi } from "vitest"

import { commands } from "@/bindings"
import { reportBackgroundError } from "@/lib/background-errors"

import { restorePetOnStartup, runPetRestoration } from "../startup"

vi.mock("@alwith/module-auth/pets/core", () => ({ getVibemonState: vi.fn(), refreshSettings: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: { autostartLaunch: vi.fn() } }))
vi.mock("@/lib/background-errors", () => ({ reportBackgroundError: vi.fn() }))
vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }))
beforeEach(() => vi.resetAllMocks())

test.each([
  [true, false, true],
  [false, true, true],
  [false, false, false]
])("restores an equipped pet with enabled=%s and login launch=%s", async (enabled, autostart, expected) => {
  vi.mocked(getVibemonState).mockResolvedValue({ pet: "pet", enabled, position: null })
  vi.mocked(commands.autostartLaunch).mockResolvedValue(autostart)
  const present = vi.fn()
  expect(await restorePetOnStartup(present, () => "account")).toBe(expected)
  expect(present).toHaveBeenCalledTimes(expected ? 1 : 0)
})

test("logged out or unequipped startup never opens a pet or a setup dialog", async () => {
  const present = vi.fn()
  expect(await restorePetOnStartup(present, () => null)).toBe(false)
  expect(refreshSettings).not.toHaveBeenCalled()
  vi.mocked(getVibemonState).mockResolvedValue({ pet: "", enabled: true, position: null })
  expect(await restorePetOnStartup(present, () => "account")).toBe(false)
  expect(commands.autostartLaunch).not.toHaveBeenCalled()
  expect(present).not.toHaveBeenCalled()
})

test("an account change during the launch query cancels restoration", async () => {
  let account = "first"
  vi.mocked(getVibemonState).mockResolvedValue({ pet: "pet", enabled: false, position: null })
  vi.mocked(commands.autostartLaunch).mockImplementation(() => {
    account = "second"
    return Promise.resolve(true)
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
    () => {
      return Promise.try(() => {
        throw error
      })
    },
    () => account,
    retry
  )
  expect(reportBackgroundError).toHaveBeenCalledExactlyOnceWith("pet-startup", error, {
    message: "pet.restoreFailed",
    action: { label: "pet.retry", onClick: expect.any(Function) as () => void }
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
    () => {
      return Promise.try(() => {
        account = null
        throw new Error("cancelled")
      })
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
