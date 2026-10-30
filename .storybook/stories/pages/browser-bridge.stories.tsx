import type { BrowserBridgeHost } from "@alwith/module-browser"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { GlobeIcon } from "lucide-react"
import { expect, userEvent, within } from "storybook/test"

import { BrowserBridgeCard } from "../../../src/features/layout/components/browser-bridge-card"

const host: BrowserBridgeHost = {
  extensionInstalled: () => Promise.resolve(false),
  bridgeInstalled: () => Promise.resolve(false),
  ping: () => Promise.resolve(false),
  setEnabled: () => Promise.resolve()
}
const meta = {
  title: "页面/主窗整体/浏览器连接",
  component: BrowserBridgeCard,
  parameters: { layout: "fullscreen" },
  args: { title: "Google Chrome", icon: <GlobeIcon />, onOpen: () => {}, active: true, host },
  decorators: [
    (Story) => (
      <div className="flex h-screen justify-end p-8">
        <div className="w-64">
          <Story />
        </div>
      </div>
    )
  ]
} satisfies Meta<typeof BrowserBridgeCard>
export default meta
type Story = StoryObj<typeof meta>
export const NotInstalled: Story = {
  name: "未安装连接器",
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Enable browser control|启用浏览器控制/ }))
    await expect(await within(document.body).findByRole("switch")).not.toBeChecked()
  }
}
export const Connected: Story = {
  name: "已连接",
  args: {
    host: {
      ...host,
      extensionInstalled: () => Promise.resolve(true),
      bridgeInstalled: () => Promise.resolve(true),
      ping: () => Promise.resolve(true)
    }
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Enable browser control|启用浏览器控制/ }))
    await expect(await within(document.body).findByRole("switch")).toBeChecked()
  }
}
