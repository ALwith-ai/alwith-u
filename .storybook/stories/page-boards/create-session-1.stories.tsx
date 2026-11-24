import preview from "../../preview"
import * as source from "../pages/create-session.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-create-session-1",
  title: "页面/主窗聊天/会话入口/01 新建会话"
})

export const Sidebar = meta.story({ ...source.Sidebar.input, name: "侧栏 · 新聊天" })
export const SidebarProject = meta.story({ ...source.SidebarProject.input, name: "侧栏项目 · 项目中新聊天" })
export const HeaderProject = meta.story({ ...source.HeaderProject.input, name: "主窗顶部 · 项目中新聊天" })
export const Collection = meta.story({ ...source.Collection.input, name: "收藏集合 · 新对话" })
