import preview from "../../preview"
import * as source from "../pages/composer-states.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-composer-input-long-text",
  title: "页面/主窗聊天/输入框/01 输入内容/04 长文本附件"
})

export const LongText = meta.story({ ...source.LongText.input, name: "长文本转为附件" })
export const LongTextPending = meta.story({ ...source.LongTextPending.input, name: "长文本附件 · 写入中" })
export const LongTextError = meta.story({ ...source.LongTextError.input, name: "长文本附件 · 写入失败" })
