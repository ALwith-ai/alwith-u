import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { settingsFixture } from "@/lib/__tests__/settings-fixture"
import { initI18n } from "@/lib/i18n"

import { PreventSleepRow } from "../prevent-sleep-row"

beforeEach(async () => {
  await initI18n("en")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("persists the opt-in and follows changes from another window", async () => {
  const fixture = settingsFixture()
  const view = render(<PreventSleepRow />)
  const toggle = view.getByRole("switch", { name: "Prevent sleep while tasks are running" })
  expect(toggle).not.toBeChecked()
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  expect(fixture.values.get("system.preventSleep")).toBe(true)
  act(() => fixture.changed({ "system.preventSleep": false }))
  expect(toggle).not.toBeChecked()
})
