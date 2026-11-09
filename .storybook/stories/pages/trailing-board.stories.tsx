import { desktopDefaults } from "@nyssance/atlas/layout"
import { DesktopCanvasContext, type DesktopCanvas } from "@alwith/module-desktop-shell/react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { TrailingBoard } from "../../../src/features/layout/components/trailing-board"
import { preparePreview, type PreviewState } from "../../fixtures/prepare"
import { setTrailingScenario, type TrailingScenario } from "../../fixtures/trailing-board"
import { ProductPreview } from "../product-preview"

interface Props extends PreviewState, TrailingScenario {}
const activeStation: DesktopCanvas = {
  viewportWidth: desktopDefaults.trailingWidth, budget: desktopDefaults.trailingWidth, region: "trailing", trailingActive: true, moving: false,
  previewSlot: null, setPreview: () => {}, navigate: () => {}
}
function HalfScreen(_props: Props) {
  const [center, setCenter] = useState(false)
  if (center) return <ProductPreview page="vibemon" />
  return <div className="flex h-dvh justify-end bg-sidebar p-4"><div className="h-full shrink-0" style={{ width: desktopDefaults.trailingWidth }}><DesktopCanvasContext value={activeStation}><TrailingBoard onOpenVibemon={() => setCenter(true)} /></DesktopCanvasContext></div></div>
}
const chrome = { name: "Google Chrome", bundle_id: "com.google.Chrome", path: "/Applications/Google Chrome.app", icon: null }
const feishu = { name: "飞书", bundle_id: "com.bytedance.macos.feishu", path: "/Applications/飞书.app", icon: null }
const meta = {
  title: "页面/右侧隐藏屏",
  component: HalfScreen,
  args: { apps: [], windows: [], petCase: "home", authenticated: true },
  loaders: [async (context) => { await preparePreview(context); setTrailingScenario({ apps: context.args.apps, windows: [...context.args.windows], browserConnected: context.args.browserConnected }) }],
  parameters: { layout: "fullscreen", productPage: true }
} satisfies Meta<typeof HalfScreen>
export default meta
type Story = StoryObj<typeof meta>


export const NoApps: Story = { name: "01 不显示应用卡片 · 没有符合条件的应用运行", parameters: { pageStateGroup: "应用卡片" } }
export const Browser: Story = { name: "02 显示应用卡片 · 浏览器与飞书正在运行", parameters: { pageStateGroup: "应用卡片" }, args: { apps: [chrome, feishu], browserConnected: true } }

export const NoWindows: Story = { name: "01 不显示工具窗口卡片", parameters: { pageStateGroup: "工具窗口" } }
export const AllWindows: Story = { name: "02 显示工具窗口卡片 · 四类窗口", parameters: { pageStateGroup: "工具窗口" }, args: { windows: ["settings", "chat", "guide", "gamepad"] } }

export const SignedOut: Story = { name: "01 未登录 · 不显示桌宠休息区", parameters: { pageStateGroup: "桌宠休息区" }, args: { authenticated: false } }
export const NoSelection: Story = { name: "02 未装扮桌宠 · 显示选择入口", parameters: { pageStateGroup: "桌宠休息区" } }
export const Resting: Story = { name: "03 已装扮且未开启 · 桌宠留在休息区", parameters: { pageStateGroup: "桌宠休息区" }, args: { petCase: "hidden" } }
export const OnDesktop: Story = { name: "04 桌宠已开启 · 休息区不重复显示桌宠", parameters: { pageStateGroup: "桌宠休息区" }, args: { petCase: "desktop" } }
