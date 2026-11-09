import type { Meta } from "@storybook/react-vite"

import navigation, * as nav from "../pages/navigation.stories"
import * as header from "../pages/chat-header.stories"
import * as floating from "../pages/floating-chat.stories"

const meta = {
  ...navigation,
  id: "page-open-main-session",
  title: "页面/主窗聊天/会话入口/02 打开已有会话/02 其他入口"
} satisfies Meta<typeof navigation.component>
export default meta

export const Search = { ...nav.PaletteResults, name: "01 搜索 · 查找已有会话" }

export const HeaderProject = { ...header.Project, name: "02 主窗顶部 · 项目内已有聊天" }

export const FloatingReturn = {
  ...floating.FloatingConversationMenu,
  name: "03 浮窗菜单 · 回到聊天主窗",
  parameters: { docs: { description: { story: "在浮窗更多操作中选择回到聊天主窗，将当前会话和草稿移回主窗。" } } },
  args: { page: "floating", chatCase: "plainText" }
}
