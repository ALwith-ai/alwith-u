import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { settingsFixture } from "@/lib/__tests__/settings-fixture"
import { initI18n } from "@/lib/i18n"
import { useThreeFingerSwipeEnabled } from "@/lib/trackpad-preference"

import { TrackpadRow } from "../trackpad-row"

function Consumer() {
  return <output>{String(useThreeFingerSwipeEnabled())}</output>
}

beforeEach(async () => {
  await initI18n("en")
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("defaults off, persists an enabled value and follows cross-window settings", async () => {
  const fixture = settingsFixture()
  const view = render(
    <>
      <TrackpadRow />
      <Consumer />
    </>
  )
  const toggle = view.getByRole("switch", {
    name: "Three-finger horizontal swipe"
  })
  expect(toggle).not.toBeChecked()
  expect(view.getByRole("status")).toHaveTextContent("false")
  const master = view.getByRole("switch", { name: "Enable trackpad gestures" })
  expect(master).not.toBeChecked()
  expect(toggle).toHaveAttribute("aria-disabled", "true")
  fireEvent.click(master)
  await waitFor(() => {
    expect(master).toBeChecked()
    expect(toggle).not.toHaveAttribute("aria-disabled", "true")
  })
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  expect(fixture.values.get("appearance.threeFingerSwipe")).toBe(true)
  expect(view.getByRole("status")).toHaveTextContent("true")
  act(() => fixture.changed({ "appearance.threeFingerSwipe": false }))
  expect(toggle).not.toBeChecked()
  expect(view.getByRole("status")).toHaveTextContent("false")
})

test("Linux cannot enable gestures even when a synced preference is enabled", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64")
  const fixture = settingsFixture({ "appearance.threeFingerSwipe": true, "appearance.trackpadEnabled": true })
  const view = render(
    <>
      <TrackpadRow />
      <Consumer />
    </>
  )
  expect(view.getByText(/Not supported on Linux/)).toBeInTheDocument()
  const toggle = view.getByRole("switch", { name: "Three-finger horizontal swipe" })
  expect(toggle).toHaveAttribute("aria-disabled", "true")
  expect(toggle).not.toBeChecked()
  fireEvent.click(toggle)
  expect(fixture.write).not.toHaveBeenCalled()
  expect(view.getByRole("status")).toHaveTextContent("false")
})

test.each([
  ["MacIntel", /Mission Control/],
  ["Win32", /Windows Settings/]
] as const)("shows conflict guidance for %s", (platform, guidance) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
  settingsFixture({ "appearance.threeFingerSwipe": true })
  const view = render(<TrackpadRow />)
  expect(view.getByText(guidance)).toBeInTheDocument()
})

test("failed persistence reports the error and keeps the saved state", async () => {
  const fixture = settingsFixture({ "appearance.trackpadEnabled": true })
  fixture.write.mockRejectedValue(new Error("Cannot save settings"))
  const error = vi.spyOn(toast, "error").mockImplementation(() => "error")
  const view = render(<TrackpadRow />)
  fireEvent.click(view.getByRole("switch", { name: "Three-finger horizontal swipe" }))
  await waitFor(() => expect(error).toHaveBeenCalledWith("Cannot save settings"))
  expect(view.getByRole("switch", { name: "Three-finger horizontal swipe" })).not.toBeChecked()
})

test("the master switch suspends input without losing the gesture selection", async () => {
  const fixture = settingsFixture({ "appearance.threeFingerSwipe": true, "appearance.trackpadEnabled": true })
  const view = render(
    <>
      <TrackpadRow />
      <Consumer />
    </>
  )
  const master = view.getByRole("switch", { name: "Enable trackpad gestures" })
  const gesture = view.getByRole("switch", { name: "Three-finger horizontal swipe" })
  fireEvent.click(master)
  await waitFor(() => expect(master).not.toBeChecked())
  expect(gesture).toBeChecked()
  expect(gesture).toHaveAttribute("aria-disabled", "true")
  expect(view.getByRole("status")).toHaveTextContent("false")
  expect(fixture.values.get("appearance.threeFingerSwipe")).toBe(true)
  expect(fixture.values.get("appearance.trackpadEnabled")).toBe(false)
  fireEvent.click(master)
  await waitFor(() => expect(master).toBeChecked())
  expect(gesture).toBeChecked()
  expect(view.getByRole("status")).toHaveTextContent("true")
})
