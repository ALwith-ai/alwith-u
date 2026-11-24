import preview from "../../preview"
import * as source from "../pages/composer-states.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-composer-input-file",
  title: "页面/主窗聊天/输入框/01 输入内容/03 文件引用"
})

export const MentionSearch = meta.story({ ...source.MentionSearch.input, name: "文件引用 · 搜索" })
export const Mention = meta.story({ ...source.Mention.input, name: "文件引用 · 已选择" })
export const MentionEmpty = meta.story({ ...source.MentionEmpty.input, name: "文件引用 · 无匹配" })
export const MentionError = meta.story({ ...source.MentionError.input, name: "文件引用 · 搜索失败" })
