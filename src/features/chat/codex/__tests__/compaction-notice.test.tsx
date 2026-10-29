import { applyUpdate, createSession } from "@nyssance/codex-acp-v2/client"
import { act, cleanup, screen } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { renderTimeline } from "../../__tests__/timeline-host"

await initI18n("en")
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test("compaction adds the Codex delay notice at ten seconds and removes it on completion", () => {
  vi.useFakeTimers()
  const session = applyUpdate(createSession("compact-delay", "/tmp"), {
    sessionUpdate: "compaction_update",
    compactionId: "compact",
    status: "in_progress"
  })
  const view = renderTimeline(session)
  expect(screen.getByText("Compacting context")).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(9999))
  expect(screen.queryByText(/This can take a few minutes/)).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(1))
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
