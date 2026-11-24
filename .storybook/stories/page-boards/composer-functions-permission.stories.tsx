import preview from "../../preview"
import * as source from "../pages/composer-states.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "page-composer-functions-permission",
  title: "页面/主窗聊天/输入框/02 输入框功能/01 权限模式"
})

export const PermissionMenu = meta.story({ ...source.PermissionMenu.input, name: "权限模式菜单" })
