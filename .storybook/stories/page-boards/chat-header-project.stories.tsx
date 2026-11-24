import preview from "../../preview"
import * as source from "../pages/chat-header.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "chat-header-project",
  title: "页面/主窗聊天/顶部操作/01 项目与标题"
})

export const Project = meta.story({ ...source.Project.input, name: "项目与聊天列表" })
export const ProjectMore = meta.story({ ...source.ProjectMore.input, name: "项目聊天 · 展开更多" })
export const ProjectSwitch = meta.story({ ...source.ProjectSwitch.input, name: "项目聊天 · 切换已有聊天" })
export const ProjectFolder = meta.story({ ...source.ProjectFolder.input, name: "项目路径 · 打开项目" })
export const ProjectNewChat = meta.story({ ...source.ProjectNewChat.input, name: "项目中新建聊天" })
