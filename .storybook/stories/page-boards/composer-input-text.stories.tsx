import preview from "../../preview"
import * as source from "../pages/composer-states.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-composer-input-text",
  title: "页面/主窗聊天/输入框/01 输入内容/01 文本输入"
})

export const TextInput = meta.story({ ...source.TextInput.input, name: "文本输入" })
export const Prediction = meta.story({ ...source.Prediction.input, name: "输入预测 · 待接受" })
export const SlashCommands = meta.story({ ...source.SlashCommands.input, name: "斜杠命令菜单" })
