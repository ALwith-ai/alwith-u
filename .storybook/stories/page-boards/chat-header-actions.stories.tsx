import preview from "../../preview"
import * as source from "../pages/chat-header.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "chat-header-actions",
  title: "页面/主窗聊天/顶部操作/03 更多操作"
})

export const More = meta.story({ ...source.More.input, name: "更多操作菜单" })
export const Rename = meta.story({ ...source.Rename.input, name: "重命名聊天" })
export const Search = meta.story({ ...source.Search.input, name: "在聊天中查找" })
export const OpenProject = meta.story({ ...source.OpenProject.input, name: "选择打开项目的应用" })
export const Delete = meta.story({ ...source.Delete.input, name: "删除聊天 · 确认" })
