import { CodexActivityGroup } from "@alwith/module-chat/activity"
import { type ActivityHost, ActivityHostProvider } from "@alwith/module-chat/activity-host"
import type { CodexActivityBlock, ToolUseBlock } from "@alwith/module-chat/group-blocks"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

afterEach(cleanup)

test("streaming one tool leaves completed activity rows untouched", () => {
  const commandStatus = vi.fn(() => "Failed")
  const host: ActivityHost = {
    t: (key) => key,
    i18n: { language: "en" },
    openLink: () => {},
    Markdown: ({ text }) => <p>{text}</p>,
    commandStatus
  }
  const completed: ToolUseBlock[] = Array.from({ length: 100 }, (_, index) => ({
    type: "tool_use",
    id: `completed-${index}`,
    name: "exec_command",
    title: "Run command",
    kind: "execute",
    status: "failed",
    content: [],
    locations: [],
    rawInput: { command: `echo ${index}` },
    rawOutput: "output"
  }))
  const content = (blocks: CodexActivityBlock[]) => (
    <ActivityHostProvider host={host}>
      <CodexActivityGroup blocks={blocks} defaultExpanded />
    </ActivityHostProvider>
  )
  const live = { ...completed[0], id: "live", status: "in_progress" }
  const view = render(content([...completed, live]))
  fireEvent.click(view.container.querySelector<HTMLButtonElement>(".codex-activity-group-trigger")!)
  expect(commandStatus).toHaveBeenCalledTimes(100)
  for (let index = 0; index < 10; index++)
    view.rerender(content([...completed, { ...live, rawOutput: `chunk ${index}` }]))
  expect(commandStatus).toHaveBeenCalledTimes(100)
  view.rerender(content([{ ...completed[0], status: "cancelled" }, ...completed.slice(1), live]))
  expect(commandStatus).toHaveBeenCalledTimes(101)
})
