import type { ToolItem } from "@nyssance/codex-acp-v2/client"
import { cleanup, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("../activity-host", () => ({
  useChatActivityHost: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
    expandToolOutput: false,
    Markdown: () => null,
    Output: () => null,
    Patch: () => null,
    openLink: vi.fn(),
    openImage: vi.fn()
  })
}))
import { renderTimeline, runningSession } from "../../__tests__/timeline-host"
afterEach(cleanup)
test("private computer actions have a readable summary even when ACP classifies them as execute", () => {
  const item: ToolItem = {
    id: "click",
    at: 1,
    endedAt: 2,
    replayed: false,
    _meta: null,
    kind: "tool",
    name: "alwith_computer.click",
    title: "alwith_computer.click",
    toolKind: "execute",
    status: "completed",
    content: [],
    locations: [],
    rawInput: { x: 20, y: 30 },
    rawOutput: null
  }
  renderTimeline(runningSession("computer-activity", "/tmp", [item]))
  expect(screen.getByText("computer.actions.click")).toBeInTheDocument()
  expect(screen.queryByText(/alwith_computer/)).not.toBeInTheDocument()
  expect(item.rawInput).toEqual({ x: 20, y: 30 })
  expect(item.toolKind).toBe("execute")
})
