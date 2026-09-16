/**
 * 侧栏面板列表项的公共封装。
 *
 * sessions / extensions / plugins / search 四个面板的列表项反复手调的公共量
 * ——尺寸(size="xs")、横向内缩(px-2.5)、hover、圆角、标题单行截断——全收口到这里,
 * 以后「四个面板一起改」= 改这一个文件。媒体 / 动作 / 描述等内容槽各面板自己 compose。
 *
 * 透传 shadcn Item 的子部件(ItemMedia/ItemContent/ItemActions/ItemDescription/ItemTitle),
 * 特殊标题(如 search 文件头的 name+dir 同行)用裸 ItemTitle 自己拼;普通单行截断用 PanelItemTitle。
 */

import type { ComponentProps } from "react"
import { OverflowMarquee } from "@/components/alwith-ui/overflow-marquee"
import { ROW_HIGHLIGHT } from "@/components/alwith-ui/surface-highlight"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"

/** 列表容器:横向留 px-2 小边距(跟面板标题对齐),不紧贴窗口边。 */
function PanelList({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col px-2", className)} {...props} />
}

/**
 * 列表项:扁平 shadcn Item,默认 size="xs" + hover。size 可覆盖。
 * 传 active 高亮选中态——对齐导航项目的选中态:
 * 选中与 hover 同 bg-accent,靠 text-accent-foreground + font-medium 区分。
 */
function PanelItem({ className, size = "xs", active, ...props }: ComponentProps<typeof Item> & { active?: boolean }) {
  return (
    <Item
      size={size}
      data-active={active}
      className={cn(
        // 圆角走 Item 基类的 rounded-md:侧栏没有玻璃底板后,hover/选中底色是浮在窗底上的
        // 一块独立高亮,直角通铺会看着像切断的色条(2026-07-26 用户指正,对齐 Codex)。
        // 底色数值在 surface-highlight.ts 一处定义,与侧栏菜单按钮共用。
        ROW_HIGHLIGHT,
        "data-[active=true]:font-medium",
        className
      )}
      {...props}
    />
  )
}

/**
 * 普通标题:ItemTitle + 内层单行省略。
 *
 * **悬停走马灯**:鼠标进来时量一次,文字真的超出才滑动 —— 滑到刚好露出末尾就停(位移 =
 * 溢出量),移开滑回。速度恒定,所以标题越长滑得越久,不会长短标题一样快。
 *
 * 没用 `react-fast-marquee` 之类:那类库是**连续循环**跑马灯,靠复制内容拼接实现无缝,
 * 用在被截断的标题上会看到「标题标题标题」。要的是 Finder / Spotify 那种「露出末尾再回来」,
 * 语义不同,套不上。
 */
function PanelItemTitle({ className, children, ...props }: ComponentProps<typeof ItemTitle>) {
  return (
    <ItemTitle className={cn("w-full", className)} {...props}>
      <OverflowMarquee>{children}</OverflowMarquee>
    </ItemTitle>
  )
}

export {
  // 裸 Item:不要默认 hover 的特例(如 sessions 组头),自己 compose
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  PanelItem,
  PanelItemTitle,
  PanelList
}
