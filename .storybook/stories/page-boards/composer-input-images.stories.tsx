import preview from "../../preview"
import * as source from "../pages/composer-states.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-composer-input-images",
  title: "页面/主窗聊天/输入框/01 输入内容/02 图片附件"
})

export const ImageAdded = meta.story({ ...source.ImageAdded.input, name: "图片附件 · 已添加" })
export const ImageLimit = meta.story({ ...source.ImageLimit.input, name: "图片总大小超限" })
export const UnsupportedAttachment = meta.story({ ...source.UnsupportedAttachment.input, name: "不支持的附件格式" })
