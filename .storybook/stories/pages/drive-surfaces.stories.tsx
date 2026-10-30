import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { DriveSurfaces } from "../drive-surfaces"
const meta = {
  id: "页面-云盘-共享与归纳",
  title: "页面/其他/云盘/共享与归纳",
  component: DriveSurfaces,
  loaders: [preparePreview],
  args: { page: "chat", chatCase: "files", surface: "sharing", driveCase: "sharing" },
  parameters: { layout: "fullscreen", productPage: true, a11y: { test: "todo" } }
} satisfies Meta<typeof DriveSurfaces>
export default meta
type Story = StoryObj<typeof meta>
export const Sharing: Story = { name: "共享权限 · 直接与继承授权" }
export const SharingReadOnly: Story = { name: "共享权限 · 只有查看权", args: { driveCase: "sharingReadOnly" } }
export const SharingError: Story = { name: "共享权限加载失败", args: { driveCase: "sharingError" } }
export const Condense: Story = { name: "归纳知识 · 开始前", args: { surface: "condense", driveCase: "ready" } }
export const Proposed: Story = {
  name: "归纳知识 · 待确认的建议",
  args: { surface: "condense", driveCase: "condenseProposed" }
}
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
