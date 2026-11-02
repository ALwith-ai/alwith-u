import { createSession } from "@alwith/module-chat/client"
import { Composer, drafts, type ModelMenuProps } from "@alwith/module-chat/conversation"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Profiler } from "react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { ChatTimelineHost } from "../../__tests__/timeline-host"
import { presentModelCatalog } from "../model-catalog"

await initI18n("en")
afterEach(() => {
  cleanup()
  drafts.clear()
})

test("typing under a large model catalog and long transcript does not rebuild the catalog", () => {
  const session = { ...createSession("typing-pressure", "/tmp"), attached: true }
  session.configOptions = [
    {
      type: "select",
      configId: "model",
      category: "model",
      name: "Model",
      currentValue: "model-0",
      options: Array.from({ length: 3000 }, (_, index) => ({ value: `model-${index}`, name: `Model ${index}` }))
    }
  ]
  session.items = Array.from({ length: 10000 }, (_, index) => ({
    kind: "user" as const,
    id: `user-${index}`,
    at: index,
    replayed: false,
    echo: null,
    _meta: null,
    content: [{ type: "text" as const, text: `Previous prompt ${index}` }]
  }))
  drafts.set(session.id, { text: "中文 abc ".repeat(3000), attachments: [], mentions: [], modelId: null })
  const catalog = vi.fn<NonNullable<ModelMenuProps["catalog"]>>(presentModelCatalog)
  const durations: number[] = []
  render(
    <ChatTimelineHost>
      <Profiler
        id="composer"
        onRender={(_, phase, duration) => {
          if (phase === "update") durations.push(duration)
        }}
      >
        <Composer session={session} predictions={false} modelMenu={{ catalog }} />
      </Profiler>
    </ChatTimelineHost>
  )
  const initialBuilds = catalog.mock.calls.length
  const input = screen.getByRole<HTMLTextAreaElement>("textbox")
  const started = performance.now()
  for (let index = 0; index < 120; index++) {
    fireEvent.change(input, { target: { value: `${input.value}字` } })
    fireEvent.input(input)
    fireEvent.keyUp(input, { key: "字" })
  }
  act(() => {})
  const ordered = durations.toSorted((a, b) => a - b)
  console.info(
    "composer-pressure",
    JSON.stringify({
      keys: 120,
      models: 3000,
      messages: 10000,
      characters: input.value.length,
      totalMs: Math.round(performance.now() - started),
      renderP95Ms: Number((ordered[Math.floor(ordered.length * 0.95)] ?? 0).toFixed(2)),
      catalogRebuilds: catalog.mock.calls.length - initialBuilds
    })
  )
  expect(input.value.endsWith("字".repeat(120))).toBe(true)
  expect(catalog.mock.calls.length).toBe(initialBuilds)
})
