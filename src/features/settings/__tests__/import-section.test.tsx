import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"
import type { ImportState } from "@/lib/imports-bridge"
const fixture = vi.hoisted((): { state: ImportState; send: ReturnType<typeof vi.fn> } => ({
  state: { phase: "idle", source: null, items: [], results: [], history: [], error: null },
  send: vi.fn().mockResolvedValue(undefined)
}))
vi.mock("@/lib/imports-bridge", () => ({ useImportState: () => fixture.state, requestImportAction: fixture.send }))
import { ImportSection } from "../sections/import-section"
beforeAll(() => initI18n("en"))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
test("offers detected-content selection without automatically importing anything", () => {
  fixture.state = { phase: "idle", source: null, items: [], results: [], history: [], error: null }
  const view = render(<ImportSection />)
  fireEvent.click(screen.getAllByRole("button", { name: "Import" })[0])
  expect(fixture.send).toHaveBeenCalledWith({ action: "detect", source: "claude-code" })
  fixture.state = {
    ...fixture.state,
    phase: "selecting",
    source: "claude-code",
    items: [{ itemType: "MEMORY", description: "Project memory", cwd: "/project", details: null }]
  }
  view.rerender(<ImportSection />)
  expect(screen.getByRole("button", { name: "Import selected (0)" })).toBeDisabled()
  fireEvent.click(screen.getByRole("checkbox"))
  fireEvent.click(screen.getByRole("button", { name: "Import selected (1)" }))
  expect(fixture.send).toHaveBeenLastCalledWith({ action: "import", indices: [0] })
})
test("shows background progress and preserves partial failure history", () => {
  fixture.state = {
    phase: "importing",
    source: "cursor",
    items: [],
    results: [],
    error: null,
    history: [
      {
        importId: "old",
        providerId: "cursor",
        completedAtMs: 1n,
        successes: [],
        failures: [
          {
            itemType: "AGENTS_MD",
            cwd: null,
            errorType: null,
            subErrorType: null,
            failureStage: "copy",
            source: "rules",
            message: "denied"
          }
        ]
      }
    ]
  }
  render(<ImportSection />)
  expect(screen.getByText("Importing")).toBeVisible()
  expect(screen.getByText("rules: denied")).toBeVisible()
  fireEvent.click(screen.getByRole("button", { name: "View details" }))
  fireEvent.click(screen.getByRole("button", { name: "Do it in background" }))
  expect(fixture.send).not.toHaveBeenCalled()
})
