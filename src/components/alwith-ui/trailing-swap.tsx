/**
 * 行尾区几何契约的唯一实现(纯 CSS,无 absolute)。GroupHeader 与 SessionItem 共用,
 * 三个概念,别在调用方手拼几何:
 *
 * 1. `TRAILING_GROUP` —— 宿主行容器挂的 group 类(tailwind 变体要静态字面量)。
 * 2. `TrailingSlot` —— 最右的 w-5 中线槽:与 icon 按钮(size-5)同宽、内容居中,
 *    灯 / 计数 / ⋯ 图标全部压同一根竖直中线;超宽内容(计数 106)围绕中线对称外溢。
 * 3. `TrailingSwap` —— 常显内容正常占位，hover 操作用 absolute 覆盖在同一右缘；
 *    操作层不参与尺寸计算，display 直接切换，不经过子按钮的 transition-all；菜单开着
 *    (data-popup-open)时操作保持显示、内容保持隐藏；操作区点击不冒泡到行。
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** 宿主行容器必须挂的 group 类(与下方 group-hover/trailing 变体配对)。 */
export const TRAILING_GROUP = "group/trailing"

/** 最右 w-5 中线槽:内容与 icon 按钮图标同轴;空 children = 占位保轨(位置恒定不抖)。 */
export function TrailingSlot({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn("flex w-5 shrink-0 items-center justify-center whitespace-nowrap", className)}>{children}</span>
  )
}

export function TrailingSwap({
  content,
  actions,
  className
}: {
  /** 常显层(灯 / 时间 / 计数);建议最右单元用 TrailingSlot 包住压中线。 */
  content?: ReactNode
  /** hover 层(⋯ / ✕ 等 icon 按钮);换位、防叠影、stopPropagation 都归本控件。 */
  actions?: ReactNode
  className?: string
}) {
  if (content == null && actions == null) return null
  return (
    <span className={cn("group/swap relative flex min-h-5 min-w-5 shrink-0 items-center justify-end", className)}>
      {content != null && (
        <span
          className={cn(
            "flex items-center justify-end",
            actions != null && "group-hover/trailing:hidden group-has-[[data-popup-open]]/swap:hidden"
          )}>
          {content}
        </span>
      )}
      {actions != null && (
        <span
          className="absolute inset-y-0 end-0 hidden w-max items-center justify-end gap-0.5 group-hover/trailing:flex has-[[data-popup-open]]:flex"
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </span>
  )
}
