import { accountKey, type PetAccount } from "@alwith/module-auth/pets"
import { configureVibemon, type VibemonHost } from "@alwith/module-auth/pets/core"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, expect, test, vi } from "vitest"

import { usePlatformAuth } from "@/features/auth/store"
import { SidebarAccountMenu } from "@/features/sessions/sidebar-account-menu"
import { must } from "@/lib/__tests__/must"
import i18n, { initI18n } from "@/lib/i18n"
import { savePreference } from "@/lib/preferences"
import { openGamepadWindow } from "@/lib/window-manager"

vi.mock("@/lib/window-manager", () => ({ openGamepadWindow: vi.fn(async () => {}) }))

vi.mock("@/lib/preferences", () => ({ savePreference: vi.fn(async () => {}) }))

const originalAuth = usePlatformAuth.getState()
let dispose = () => {}
afterEach(async () => {
  await act(() => {
    return Promise.try(() => {
      cleanup()
      dispose()
      usePlatformAuth.setState(originalAuth, true)
    })
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
  const openPet = vi.fn(() => {
    return Promise.try(() => {
      if (failure) throw failure
      must(accounts[accountKey(account)], "pet account").enabled = true
      changed()
      return "shown" as const
    })
  })
  const closePet = vi.fn(() => {
    return Promise.try(() => {
      must(accounts[accountKey(account)], "pet account").enabled = false
      changed()
    })
  })
  dispose = configureVibemon({
    account: () => account,
    assets: {} as VibemonHost["assets"],
    storage: {
      get: <T,>(key: string) => Promise.try(() => (key === "vibemon.accounts" ? structuredClone(accounts) : {}) as T),
      set: async () => {}
    },
    subscribeStorage: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sessions: {} as VibemonHost["sessions"],
    windows: { openPet, closePet } as unknown as VibemonHost["windows"],
    onError: (error) => {
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
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: /Pet tester/ }))))
  return view
}

test("the account menu groups settings and language above tools and sign out", async () => {
  await initI18n("en")
  const f = fixture(false)
  const view = await openMenu()
  await waitFor(() =>
    expect(view.getByRole("menuitem", { name: "Show Vibémon" }).getAttribute("aria-disabled")).not.toBe("true")
  )
  expect(view.getAllByRole("menuitem")).toEqual(
    ["Settings", "Language", "Show Vibémon", "Gamepad", "Sign out"].map((name) => view.getByRole("menuitem", { name }))
  )
  expect(view.getByRole("menuitem", { name: "Settings" }).parentElement).toBe(
    view.getByRole("menuitem", { name: "Language" }).parentElement
  )
  expect(view.getByRole("menuitem", { name: "Gamepad" }).parentElement).toBe(
    view.getByRole("menuitem", { name: "Show Vibémon" }).parentElement
  )
  expect(view.getByRole("menuitem", { name: "Settings" }).parentElement?.nextElementSibling).toHaveAttribute(
    "role",
    "separator"
  )
  expect(view.getByRole("menuitem", { name: "Gamepad" }).parentElement?.nextElementSibling).toHaveAttribute(
    "role",
    "separator"
  )
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem", { name: "Show Vibémon" }))))
  expect(f.openPet).toHaveBeenCalledTimes(1)
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: /Pet tester/ }))))
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Hide Vibémon" })).toBeTruthy())
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem", { name: "Hide Vibémon" }))))
  expect(f.closePet).toHaveBeenCalledTimes(1)
})

test("closing from the pet updates the account menu and language changes translate its action", async () => {
  await initI18n("en")
  const f = fixture(true)
  const view = await openMenu()
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Hide Vibémon" })).toBeTruthy())
  await act(() => Promise.try(() => f.closeExternally()))
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Show Vibémon" })).toBeTruthy())
  await act(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  expect(view.getByRole("menuitem", { name: "显示 Vibémon" })).toBeTruthy()
  expect(f.openPet).not.toHaveBeenCalled()
  expect(f.closePet).not.toHaveBeenCalled()
})

test("account changes display the new account's switch state", async () => {
  await initI18n("en")
  const f = fixture(true)
  const view = await openMenu()
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Hide Vibémon" })).toBeTruthy())
  await act(() => Promise.try(() => f.switchAccount()))
  await waitFor(() => expect(view.getByRole("menuitem", { name: "Show Vibémon" })).toBeTruthy())
})

test("failed presentation reports the error and keeps the saved switch disabled", async () => {
  await initI18n("en")
  const f = fixture(false, new Error("Vibemon display unavailable"))
  const error = vi.spyOn(toast, "error").mockImplementation(() => "toast")
  try {
    const view = await openMenu()
    await waitFor(() =>
      expect(view.getByRole("menuitem", { name: "Show Vibémon" }).getAttribute("aria-disabled")).not.toBe("true")
    )
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem", { name: "Show Vibémon" }))))
    expect(f.openPet).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith("Vibémon display unavailable", expect.objectContaining({ id: "pet-operation" }))
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: /Pet tester/ }))))
    expect(view.getByRole("menuitem", { name: "Show Vibémon" })).toBeTruthy()
  } finally {
    error.mockRestore()
  }
})

test("the Gamepad menu action opens its dedicated window", async () => {
  await initI18n("en")
  fixture(false)
  const view = await openMenu()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem", { name: "Gamepad" }))))
  expect(openGamepadWindow).toHaveBeenCalledOnce()
})

test("the language submenu marks the current language and saves a new selection", async () => {
  await initI18n("en")
  fixture(false)
  const view = await openMenu()
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitem", { name: "Language" }))))
  expect(view.getByRole("menuitemradio", { name: "English" })).toHaveAttribute("aria-checked", "true")
  await act(() => Promise.try(() => fireEvent.click(view.getByRole("menuitemradio", { name: "简体中文" }))))
  expect(i18n.language).toBe("zh-CN")
  expect(savePreference).toHaveBeenCalledWith("language", "zh-CN")
})
