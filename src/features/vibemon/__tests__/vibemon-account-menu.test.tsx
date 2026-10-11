import { afterEach, expect, vi, test } from "vitest"
import { accountKey, type PetAccount } from "@alwith/module-auth/pets"
import { configureVibemon, type VibemonHost } from "@alwith/module-vibemon"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { usePlatformAuth } from "@/features/auth/store"
import { SidebarAccountMenu } from "@/features/threads/sidebar-account-menu"
import { must } from "@/lib/__tests__/must"
import i18n, { initI18n } from "@/lib/i18n"

const originalAuth = usePlatformAuth.getState()
let dispose = () => {}
afterEach(async () => {
  await act(async () => {
    cleanup()
    dispose()
    usePlatformAuth.setState(originalAuth, true)
  })
})

function fixture(enabled: boolean, failure?: Error) {
  let account: PetAccount = { apiHost: "api.example.test", userId: "first", revision: 1 }
  const accounts: Record<string, { pet: string; enabled: boolean; position: null }> = {
    [accountKey(account)]: { pet: "selected-pet", enabled, position: null }
  }
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) listener()
  }
  const openPet = vi.fn(async () => {
    if (failure) throw failure
    must(accounts[accountKey(account)], "pet account").enabled = true
    changed()
    return "shown" as const
  })
  const closePet = vi.fn(async () => {
    must(accounts[accountKey(account)], "pet account").enabled = false
    changed()
  })
  dispose = configureVibemon({
    account: () => account,
    assets: {} as VibemonHost["assets"],
    storage: {
      get: async <T,>(key: string) => (key === "vibemon.accounts" ? structuredClone(accounts) : {}) as T,
      set: async () => {}
    },
    subscribeStorage: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sessions: {} as VibemonHost["sessions"],
    windows: { openPet, closePet } as unknown as VibemonHost["windows"],
    onError: error => {
      throw error
    }
  })
  const signIn = () =>
    usePlatformAuth.setState({
      user: { user_uuid: account.userId, nickname: "Pet tester", login_email: "pet@example.test" }
    })
  signIn()
  return {
    openPet,
    closePet,
    closeExternally() {
      must(accounts[accountKey(account)], "pet account").enabled = false
      changed()
    },
    switchAccount() {
      account = { ...account, userId: "second", revision: 2 }
      accounts[accountKey(account)] = { pet: "other-pet", enabled: false, position: null }
      signIn()
      changed()
    }
  }
}

async function openMenu() {
  const view = render(<SidebarAccountMenu onOpenSettings={() => {}} />)
  await act(async () => fireEvent.click(view.getByRole("button", { name: /Pet tester/ })))
  return view
}

test("the manual switch sits above Settings and follows successful pet operations", async () => {
  await initI18n("en")
  const f = fixture(false)
  const view = await openMenu()
  await waitFor(() =>
    expect(view.getByRole("menuitem", { name: "Enable Vibemon" }).getAttribute("aria-disabled")).not.toBe("true")
  )
  expect(view.getByRole("menuitem", { name: "Enable Vibemon" }).nextElementSibling).toBe(
    view.getByRole("menuitem", { name: "Settings" })
  )
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "Enable Vibemon" })))
  expect(f.openPet).toHaveBeenCalledTimes(1)
  await act(async () => fireEvent.click(view.getByRole("button", { name: /Pet tester/ })))
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Disable Vibemon" })).toBeTruthy())
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "Disable Vibemon" })))
  expect(f.closePet).toHaveBeenCalledTimes(1)
})

test("closing from the pet updates the account menu and language changes translate its action", async () => {
  await initI18n("en")
  const f = fixture(true)
  const view = await openMenu()
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Disable Vibemon" })).toBeTruthy())
  await act(async () => f.closeExternally())
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Enable Vibemon" })).toBeTruthy())
  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(view.getByRole("menuitem", { name: "开启 Vibemon" })).toBeTruthy()
  expect(f.openPet).not.toHaveBeenCalled()
  expect(f.closePet).not.toHaveBeenCalled()
})

test("account changes display the new account's switch state", async () => {
  await initI18n("en")
  const f = fixture(true)
  const view = await openMenu()
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Disable Vibemon" })).toBeTruthy())
  await act(async () => f.switchAccount())
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Enable Vibemon" })).toBeTruthy())
})

test("failed presentation reports the error and keeps the saved switch disabled", async () => {
  await initI18n("en")
  const f = fixture(false, new Error("Display unavailable"))
  const error = vi.spyOn(toast, "error").mockImplementation(() => "toast")
  try {
    const view = await openMenu()
    await waitFor(() =>
      expect(view.getByRole("menuitem", { name: "Enable Vibemon" }).getAttribute("aria-disabled")).not.toBe("true")
    )
    await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "Enable Vibemon" })))
    expect(f.openPet).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith("Display unavailable")
    await act(async () => fireEvent.click(view.getByRole("button", { name: /Pet tester/ })))
    expect(view.getByRole("menuitem", { name: "Enable Vibemon" })).toBeTruthy()
  } finally {
    error.mockRestore()
  }
})
