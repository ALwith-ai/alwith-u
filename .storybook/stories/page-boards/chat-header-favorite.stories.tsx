import preview from "../../preview"
import * as source from "../pages/chat-header.stories.tsx"
// Generated page catalog from the source stories.
import { ProductPreview } from "../product-preview"

const meta = preview.meta({
  component: ProductPreview,
  ...source.pageMeta,
  id: "chat-header-favorite",
  title: "页面/主窗聊天/顶部操作/02 收藏"
})

export const Favorite = meta.story({ ...source.Favorite.input, name: "收藏与选择集合" })
export const Favorited = meta.story({ ...source.Favorited.input, name: "已收藏聊天" })
export const FavoriteSelected = meta.story({ ...source.FavoriteSelected.input, name: "已收藏 · 查看所属集合与移除" })
export const FavoriteCreate = meta.story({ ...source.FavoriteCreate.input, name: "收藏 · 创建集合" })
