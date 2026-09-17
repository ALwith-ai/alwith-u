/**
 * RowMoreMenu —— 行/组头 hover ⋯ 菜单的统一触发钮 + 容器:
 * size-5 触发钮(贴 TrailingSwap 的 w-5 中线)+ size-3.5 ⋯ 图标 + min-w-[160px] 内容。
 * 菜单项直接用 DropdownMenuItem 内置排版(gap-2 / svg size-4),别再手写 me-2/size。
 * Collection 行、Collection 组头、Sessions 行共用;新增行级菜单一律走这里。
 */
import { SquareIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

/** 行尾图标钮的共同外形:与 ⋯ 同一个 size-5 中线槽(TrailingSwap 的 w-5)。 */
function RowIconButton({ title, onPress, children }: { title: string; onPress: () => void; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-5"
      title={title}
      onClick={event => {
        event.stopPropagation()
        onPress()
      }}>
      {children}
    </Button>
  )
}

/**
 * 行尾**停止**钮 —— 方块,不是 ✕。
 *
 * 语义是停止不是释放(2026-07-27 用户定「绿灯灭」):releaseSession 只是本窗不再持有、
 * agent 继续跑,点完灯还亮着,那不是用户期待的事。只在会话真的活着时给这颗钮 ——
 * 不活的磁盘会话没有可停的东西,那格照旧显示时间。
 */
export function RowStopButton({ title, onStop }: { title: string; onStop: () => void }) {
  return (
    <RowIconButton title={title} onPress={onStop}>
      <SquareIcon className="size-3 fill-current" />
    </RowIconButton>
  )
}
