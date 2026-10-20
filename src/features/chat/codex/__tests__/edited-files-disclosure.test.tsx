import type { ToolItem } from "@alwith/api"
import { fireEvent, render } from "@testing-library/react"
import { expect, test } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

import { EditedFilesCard } from "../edited-files-card"

await initI18n("en")
const item: ToolItem = {
  id: "edits",
  kind: "tool",
  at: 1,
  endedAt: 2,
  replayed: true,
  _meta: null,
  name: "edit",
  title: "Edit files",
  toolKind: "edit",
  status: "completed",
  locations: [],
  rawInput: null,
  rawOutput: null,
  content: [
    {
      type: "diff",
      changes: Array.from({ length: 5 }, (_, i) => ({ path: `/project/file-${i}.txt`, operation: "modify" as const }))
    }
  ]
}

test("shows three files by default, expands the rest and can collapse again", () => {
  const view = render(
    <ThemeProvider>
      <EditedFilesCard items={[item]} />
    </ThemeProvider>
  )
  expect(view.container.querySelectorAll(".codex-edited-file-row")).toHaveLength(3)
  fireEvent.click(view.getByRole("button", { name: "Show 2 more files" }))
  expect(view.container.querySelectorAll(".codex-edited-file-row")).toHaveLength(5)
  fireEvent.click(view.getByRole("button", { name: "Show fewer files" }))
  expect(view.container.querySelectorAll(".codex-edited-file-row")).toHaveLength(3)
  fireEvent.click(view.getByRole("button", { name: "Hide changes" }))
  expect(view.container.querySelectorAll(".codex-edited-file-row")).toHaveLength(0)
  fireEvent.click(view.getByRole("button", { name: "View changes" }))
  expect(view.container.querySelectorAll(".codex-edited-file-row")).toHaveLength(3)
})
