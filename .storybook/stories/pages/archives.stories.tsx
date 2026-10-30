import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"

import { preparePreview } from "../../fixtures/prepare"
import { productPreviewArgTypes } from "../preview-options"
import { ProductPreview } from "../product-preview"

const meta = {
  id: "页面-聊天归档",
  title: "页面/负一屏/归档/页面状态",
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

export const List: Story = { name: "归档列表" }

export const Empty: Story = { name: "没有归档", args: { archiveCase: "empty" } }

export const Loading: Story = { name: "加载中", args: { archiveCase: "loading" } }

export const Many: Story = { name: "大量归档 · 滚动", args: { archiveCase: "many" } }

export const NoResults: Story = {
  name: "搜索无匹配",
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "搜索已归档的聊天" }), "no-match-937")
  }
}

export const DeleteAll: Story = {
  name: "全部删除确认",
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole("button", { name: "全部删除" })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
  }
}

export const LoadError: Story = {
  name: "加载失败与重试",
  args: { archiveCase: "loadError" },
  play: async ({ canvas }) => {
    await canvas.findByRole("alert")
  }
}
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
