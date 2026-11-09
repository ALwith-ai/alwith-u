import type { Meta } from "@storybook/react-vite"
import { within } from "storybook/test"

import navigation, * as nav from "../pages/navigation.stories"

const meta = {
  ...navigation,
  id: "page-open-main-sidebar",
  title: "页面/主窗聊天/会话入口/02 打开已有会话/01 侧栏"
} satisfies Meta<typeof navigation.component>
export default meta

export const ProjectList = { ...nav.ProjectSessionActions, name: "01 侧栏聊天 · 项目会话" }

export const Collections = { ...nav.Collections, name: "02 收藏集合 · 已收藏的会话" }

export const Activity = { ...nav.Activity, name: "03 侧栏活动 · 主窗会话" }

export const ActivityReturn = {
  ...nav.ActivityFloatingHidden,
  name: "04 侧栏活动 · 浮窗会话返回主窗",
  parameters: { docs: { description: { story: "在活动列表悬停浮窗会话，从详情中选择返回主窗；直接点击会话则在浮窗打开。" } } },
  play: async ({ canvasElement, userEvent }: Parameters<NonNullable<typeof nav.ActivityFloatingHidden.play>>[0]) => {
    const row = canvasElement.querySelector<HTMLElement>('[data-session-id="running"]')
    if (row) await userEvent.hover(row)
    else await within(canvasElement).findByText("后台")
  }
}
