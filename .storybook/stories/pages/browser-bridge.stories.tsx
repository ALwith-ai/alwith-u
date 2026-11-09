import type { BrowserBridgeHost } from "@alwith/module-browser"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { GlobeIcon } from "lucide-react"
import { userEvent, within } from "storybook/test"

import { BrowserBridgeCard } from "../../../src/features/layout/components/browser-bridge-card"

const host: BrowserBridgeHost = {
  extensionInstalled: () => Promise.resolve(false),
  bridgeInstalled: () => Promise.resolve(false),
  ping: () => Promise.resolve(false),
  setEnabled: () => Promise.resolve()
}
const meta = {
  title: "页面/右侧隐藏屏",
  component: BrowserBridgeCard,
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "02：扩展已安装，但“启用浏览器控制”开关关闭，连接桥尚未注册。两个圆点为一绿一灰。产品提示：打开“启用浏览器控制”以注册桥。\n\n03：扩展已安装，“启用浏览器控制”开关打开，连接桥已注册，但尚未建立连接。两个圆点同样为一绿一灰。产品提示：重新加载扩展或重启浏览器，然后再次检测。\n\n浏览器缩略卡片和详情浮层复用真实产品组件。详情锚定在卡片右下角的状态圆点上，向左展开；错开和重叠保留产品原有定位。" } }
  },
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
const openDetails: Story["play"] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole("button", { name: /Enable browser control|启用浏览器控制/ }))
}

export const NotInstalled: Story = {
  name: "01 扩展未安装",
  parameters: { pageStateGroup: "浏览器连接" },
  play: openDetails
}

export const Disabled: Story = {
  name: "02 开关关闭 · 扩展已安装，控制未启用",
  parameters: { pageStateGroup: "浏览器连接", docs: { description: { story: "扩展已安装，但“启用浏览器控制”开关关闭，连接桥尚未注册。两个圆点为一绿一灰。产品提示：打开“启用浏览器控制”以注册桥。" } } },
  args: { host: { ...host, extensionInstalled: () => Promise.resolve(true) } },
  play: openDetails
}

export const Disconnected: Story = {
  name: "03 开关打开 · 控制已启用，连接未建立",
  parameters: { pageStateGroup: "浏览器连接", docs: { description: { story: "扩展已安装，“启用浏览器控制”开关打开，连接桥已注册，但尚未建立连接。两个圆点同样为一绿一灰。产品提示：重新加载扩展或重启浏览器，然后再次检测。" } } },
  args: { host: { ...host, extensionInstalled: () => Promise.resolve(true), bridgeInstalled: () => Promise.resolve(true) } },
  play: openDetails
}

export const Connected: Story = {
  name: "04 已连接",
  parameters: { pageStateGroup: "浏览器连接" },
  args: {
    host: {
      ...host,
      extensionInstalled: () => Promise.resolve(true),
      bridgeInstalled: () => Promise.resolve(true),
      ping: () => Promise.resolve(true)
    }
  },
  play: openDetails
}
