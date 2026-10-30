import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  title: "流程/负一屏/归档/错误与等待",
  component: ProductPreview,
  loaders: [preparePreview],
  args: { page: "archives" },
  parameters: {
    layout: "fullscreen",
    productPage: true,
    a11y: { test: "todo" },
    docs: {
      description: {
        component:
          "Source components with isolated in-memory host data. Every example can be reset by selecting it again."
      }
    }
  },
  argTypes: productPreviewArgTypes
} satisfies Meta<typeof ProductPreview>
export default meta
type Story = StoryObj<typeof meta>

export const RestoreError: Story = {
  name: "恢复失败",
  args: { archiveCase: "restoreError" },
  play: async ({ canvas, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "取消归档" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0]!)
    await canvas.findByRole("alert")
  }
}
export const Restoring: Story = {
  ...RestoreError,
  name: "恢复中",
  args: { archiveCase: "restoring" },
  play: async ({ canvas, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "取消归档" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0]!)
    await expect(buttons[0]).toBeDisabled()
  }
}
export const DeleteError: Story = {
  name: "单条删除失败",
  args: { archiveCase: "deleteError" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "删除" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0]!)
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: /删除/ }))
    await dialog.findByRole("alert")
  }
}
export const Deleting: Story = {
  ...DeleteError,
  name: "单条删除中",
  args: { archiveCase: "deleting" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const buttons = await canvas.findAllByRole("button", { name: "删除" })
    await waitFor(() => expect(buttons[0]).toBeEnabled())
    await userEvent.click(buttons[0]!)
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: /删除/ }))
    await expect(dialog.getByRole("button", { name: /删除/ })).toBeDisabled()
  }
}
export const PartialDelete: Story = {
  name: "批量删除部分失败 · 保留失败项",
  args: { archiveCase: "partialDelete" },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const button = await canvas.findByRole("button", { name: "全部删除" })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog"))
    await userEvent.click(dialog.getByRole("button", { name: /删除/ }))
    await dialog.findByRole("alert")
  }
}
