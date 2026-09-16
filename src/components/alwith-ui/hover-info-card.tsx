/**
 * HoverInfoCard —— 悬停浮窗的**统一内容排版**。会话行(左导航 / Collection / Activity /
 * 会话列)与聊天区轮次刻度尺共用同一张卡:标题一行,正文可选,其下若干「图标 + 一行字」。
 *
 * 收口的是排版,不是数据:各处自己决定标题写什么、出几行;间距、字号、图标轨宽只在这里定义一次。
 *
 * `actions` —— 行操作从行尾 ⋯ 挪进来(2026-07-27 用户定)。**做成一列带图标带文字的菜单项,
 * 不是一排图标钮**:各处动作数量差很多(会话列 3 个、Collection 会话行 5 个),图标排一多就挤,
 * 而且「移动到组」和「移出组」这类语义靠图标根本区分不开。行尾那格让给 ✕(停止会话)。
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface HoverInfoRow {
  icon: ReactNode
  text: ReactNode
}

export function HoverInfoCard({
  title,
  titleIcon,
  body,
  rows,
  details,
  actions
}: {
  title: ReactNode
  titleIcon?: ReactNode
  body?: ReactNode
  rows?: HoverInfoRow[]
  details?: HoverInfoRow[]
  /** 行操作区(卡片底部,与信息之间一条分隔线);没有就不渲染分隔线。 */
  actions?: ReactNode
}) {
  return (
    <div data-slot="hover-info-card" className="flex flex-col gap-1.5">
      <div data-slot="hover-info-card-summary" className="flex min-w-0 flex-col gap-1">
        <div data-slot="hover-info-card-title-row" className="flex min-w-0 items-center gap-1.5">
          {titleIcon != null && (
            <span data-slot="hover-info-card-icon" className="flex h-5 w-4 shrink-0 items-center justify-center">
              {titleIcon}
            </span>
          )}
          <div
            data-slot="hover-info-card-title"
            className="text-foreground line-clamp-2 min-w-0 flex-1 text-sm break-words">
            {title}
          </div>
        </div>
        {body != null && (
          <div data-slot="hover-info-card-body" className="text-muted-foreground line-clamp-2 text-xs break-words">
            {body}
          </div>
        )}
        <HoverInfoRows rows={rows} />
      </div>
      {details != null && details.length > 0 && (
        <div data-slot="hover-info-card-details" className="flex min-w-0 flex-col gap-1.5">
          <HoverInfoRows rows={details} />
        </div>
      )}
      {actions != null && (
        <>
          <div data-slot="hover-info-card-separator" className="bg-border -mx-3 mt-1.5 h-px" />
          <div data-slot="hover-info-card-actions" className="-mx-1 flex flex-col">
            {actions}
          </div>
        </>
      )}
    </div>
  )
}

function HoverInfoRows({ rows }: { rows?: HoverInfoRow[] }) {
  return rows?.map((row, index) => (
    // 行本身没有稳定 id(纯展示),顺序即身份
    // biome-ignore lint/suspicious/noArrayIndexKey: 静态展示行,顺序固定且不重排
    <div key={index} data-slot="hover-info-card-row" className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <span data-slot="hover-info-card-icon" className="flex h-5 w-4 shrink-0 items-center justify-center">
        {row.icon}
      </span>
      <span className="min-w-0 break-all">{row.text}</span>
    </div>
  ))
}

/**
 * 浮板底部的一个动作项 —— 排版对齐 DropdownMenuItem(h-8 / gap-2 / svg size-4),
 * 但它不在菜单里,所以是普通按钮:卡片本身已经是浮层,再套一层菜单只会让关闭时机打架。
 */
export function HoverInfoAction({
  icon,
  label,
  trailing,
  onClick
}: {
  icon: ReactNode
  label: ReactNode
  /** 右侧附加(如「移动到组」的 ▾)。 */
  trailing?: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      data-slot="hover-info-card-action"
      type="button"
      onClick={onClick}
      className={cn(
        "text-foreground hover:bg-foreground/5 active:bg-foreground/10 flex h-8 w-full items-center gap-2 rounded-sm px-2 text-start text-sm",
        "[&_svg]:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0"
      )}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}
