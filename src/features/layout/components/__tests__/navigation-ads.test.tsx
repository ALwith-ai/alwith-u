import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { initI18n } from "@/lib/i18n"
import { openGamepadWindow } from "@/lib/window-manager"
import { NavigationAds } from "../navigation-ads"

vi.mock("@/lib/window-manager", () => ({ openGamepadWindow: vi.fn(async () => {}) }))
await initI18n("en")
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test("campaigns open their own surfaces in Desktop order", () => {
  const openVibemon = vi.fn()
  const view = render(<NavigationAds onOpenVibemon={openVibemon} />)
  const buttons = view.getAllByRole("button")
  expect(buttons.map(button => button.getAttribute("aria-label"))).toEqual(["Explore Vibémon", "Explore gamepad"])
  fireEvent.click(buttons[0])
  expect(openVibemon).toHaveBeenCalledOnce()
  expect(openGamepadWindow).not.toHaveBeenCalled()
  fireEvent.click(buttons[1])
  expect(openGamepadWindow).toHaveBeenCalledOnce()
})
