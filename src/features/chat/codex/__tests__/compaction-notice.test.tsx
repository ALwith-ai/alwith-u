import { applyUpdate, createSession } from "@alwith/module-chat/client"
import { act, cleanup, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { makeSession } from "../../../../../.storybook/fixtures/catalog"
import { initI18n } from "@/lib/i18n"

import { renderTimeline } from "../../__tests__/timeline-host"

await initI18n("en")
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test.each([
  ["activityEdit", "Editing files"],
  ["activityRun", "Running"],
  ["activitySearch", "Searching for files"],
  ["activityWeb", "Searching the web"],
  ["activityDelete", "Deleting files"],
  ["activityMove", "Moving files"]
] as const)("renders %s activity", async (kind, label) => {
  const view = renderTimeline(makeSession(kind))
  await act(async () => {})
  const activity = view.container.querySelector(".codex-activity-running")
  expect(activity).toBeVisible()
  expect(activity).toHaveTextContent(label)
})

test("renders the active thinking state", async () => {
  const view = renderTimeline(makeSession("reasoning"))
  await act(async () => {})
  expect(view.container.textContent).toContain("Thinking")
})

test("renders completed activities together while the conversation continues", async () => {
  const view = renderTimeline(makeSession("completedActivities"))
  await act(async () => {})
  expect(view.container.textContent).toContain("Read files")
  expect(view.container.textContent).toContain("Searched for files")
  expect(view.container.textContent).toContain("Searched the web")
  expect(view.container.textContent).toContain("Edited files")
  expect(view.container.textContent).toContain("Ran")
  expect(view.container.textContent).toContain("Deleted files")
  expect(view.container.textContent).toContain("Moved files")
  expect(view.container.textContent).toContain("Thinking")
})

test("compaction adds the Codex delay notice at ten seconds and removes it on completion", async () => {
  vi.useFakeTimers()
  const session = applyUpdate(createSession("compact-delay", "/tmp"), {
    sessionUpdate: "compaction_update",
    compactionId: "compact",
    status: "in_progress"
  })
  const view = renderTimeline(session)
  expect(screen.getByText("Compacting context")).toBeInTheDocument()
  await act(() => vi.advanceTimersByTime(9999))
  expect(screen.queryByText(/This can take a few minutes/)).not.toBeInTheDocument()
  await act(() => vi.advanceTimersByTime(1))
  expect(screen.getByText("Compacting context · This can take a few minutes")).toBeInTheDocument()
  view.unmount()
  const done = applyUpdate(session, {
    sessionUpdate: "compaction_update",
    compactionId: "compact",
    status: "completed"
  })
  renderTimeline(done)
  expect(screen.queryByText(/This can take a few minutes/)).not.toBeInTheDocument()
  expect(screen.getByText("Context compacted")).toBeInTheDocument()
})
