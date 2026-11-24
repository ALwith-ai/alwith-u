import preview from "../../preview"
import * as source from "../pages/composer-states.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-composer-functions-send",
  title: "页面/主窗聊天/输入框/02 输入框功能/05 发送与停止"
})

export const SendEmpty = meta.story({ ...source.SendEmpty.input, name: "输入为空 · 无法发送" })
export const StopRunning = meta.story({ ...source.StopRunning.input, name: "执行中 · 停止生成" })
