import preview from "../../preview"
import * as source from "../pages/composer-states.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-composer-functions-model",
  title: "页面/主窗聊天/输入框/02 输入框功能/02 模型选择"
})

export const ModelPicker = meta.story({ ...source.ModelPicker.input, name: "模型选择菜单" })
