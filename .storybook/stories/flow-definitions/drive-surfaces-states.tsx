import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { DriveSurfaces } from "../drive-surfaces"
const meta = {
  title: "流程/其他/云盘与资料/共享与归纳",
  component: DriveSurfaces,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", surface: "sharing", driveCase: "sharing" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof DriveSurfaces>
export default meta
type Story = StoryObj<typeof meta>

export const Unsynced: Story = {
  name: "归纳知识 · 未同步文件提醒",
  args: { surface: "condense", driveCase: "condenseUnsynced" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "沉淀为知识" }))
    await body.findByText("README.md")
  }
}
export const Running: Story = {
  name: "归纳知识 · 处理中",
  args: { surface: "condense", driveCase: "condenseRunning" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "沉淀为知识" }))
    await body.findByRole("status")
  }
}
export const Done: Story = {
  ...Running,
  name: "归纳知识 · 完成与打开结果",
  args: { surface: "condense", driveCase: "condenseDone" }
}
export const Failed: Story = {
  ...Running,
  name: "归纳知识 · 失败与重试",
  args: { surface: "condense", driveCase: "condenseError" },
  play: async ({ canvasElement, userEvent }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole("button", { name: "沉淀为知识" }))
    await waitFor(async () => expect(await body.findByRole("alert")).toBeVisible())
  }
}
