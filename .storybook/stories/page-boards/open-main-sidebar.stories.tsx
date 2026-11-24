import { within } from "storybook/test"

import preview from "../../preview"
import * as nav from "../pages/navigation.stories"
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...nav.pageMeta,
  id: "page-open-main-sidebar",
  title: "页面/主窗聊天/会话入口/02 打开已有会话/01 侧栏"
})

export const ProjectList = meta.story({ ...nav.ProjectSessionActions.input, name: "01 侧栏聊天 · 项目会话" })

export const Collections = meta.story({ ...nav.Collections.input, name: "02 收藏集合 · 已收藏的会话" })

export const Activity = meta.story({ ...nav.Activity.input, name: "03 侧栏活动 · 主窗会话" })

export const ActivityReturn = meta.story({
  ...nav.ActivityFloatingHidden.input,
  name: "04 侧栏活动 · 浮窗会话返回主窗",
  parameters: {
    docs: { description: { story: "在活动列表悬停浮窗会话，从详情中选择返回主窗；直接点击会话则在浮窗打开。" } }
  },
  play: async ({ canvasElement, userEvent }) => {
    const row = canvasElement.querySelector<HTMLElement>('[data-session-id="running"]')
    if (row) await userEvent.hover(row)
    else await within(canvasElement).findByText("后台")
  }
})
