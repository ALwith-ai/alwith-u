import type { ComponentProps } from "react"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import preview from "../../preview"
import { DriveSurfaces } from "../drive-surfaces"
import type { SharedMeta } from "../page-meta"
export const pageMeta = {
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", surface: "sharing", driveCase: "sharing" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies SharedMeta<ComponentProps<typeof DriveSurfaces>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "流程/其他/云盘与资料/共享与归纳",
  excludeStories: ["pageMeta"],
  component: DriveSurfaces,
  ...pageMeta
})

export const Unsynced = meta.story({
  name: "归纳知识 · 未同步文件提醒",
  args: { surface: "condense", driveCase: "condenseUnsynced" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "沉淀为知识" }))
    await body.findByText("README.md")
  }
})
export const Running = meta.story({
  name: "归纳知识 · 处理中",
  args: { surface: "condense", driveCase: "condenseRunning" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "沉淀为知识" }))
    await body.findByRole("status")
  }
})
export const Done = meta.story({
  ...Running.input,
  name: "归纳知识 · 完成与打开结果",
  args: { surface: "condense", driveCase: "condenseDone" }
})
export const Failed = meta.story({
  ...Running.input,
  name: "归纳知识 · 失败与重试",
  args: { surface: "condense", driveCase: "condenseError" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "沉淀为知识" }))
    await waitFor(async () => expect(await body.findByRole("alert")).toBeVisible())
  }
})
