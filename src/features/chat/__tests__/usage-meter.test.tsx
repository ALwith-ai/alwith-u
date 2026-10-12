import { applyUpdate, createSession } from "@alwith/api"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { expect, test } from "vitest"
import { initI18n } from "@/lib/i18n"
import { UsageMeter } from "../usage-meter"

await initI18n("en")

test("the first turn shows reported context before completion without inventing token counts", async () => {
  let session = createSession("first", "/tmp")
  const view = render(<UsageMeter session={session} />)
  expect(view.queryByRole("button")).toBeNull()
  session = applyUpdate(session, { sessionUpdate: "usage_update", used: 12500, size: 100000 })
  view.rerender(<UsageMeter session={session} />)
  expect(view.getByRole("button")).toHaveTextContent("13%")
  fireEvent.mouseEnter(view.getByRole("button"))
  await waitFor(() => expect(view.getByText("12,500 / 100,000 tokens · 12.5%")).toBeInTheDocument())
  expect(view.queryByText("Input")).toBeNull()
  session = applyUpdate(session, {
    sessionUpdate: "state_update",
    state: "idle",
    stopReason: "end_turn",
    usage: { totalTokens: 12500, inputTokens: 2000, cachedReadTokens: 10000, cachedWriteTokens: 0, outputTokens: 500 }
  })
  view.rerender(<UsageMeter session={session} />)
  expect(view.getByText("2,000")).toBeInTheDocument()
  expect(view.getByText("10,000")).toBeInTheDocument()
  expect(view.getByText("83.3%")).toBeInTheDocument()
  expect(view.getByText("12,500")).toBeInTheDocument()
  view.rerender(<UsageMeter session={createSession("second", "/tmp/second")} />)
  expect(view.queryByRole("button")).toBeNull()
})
