import { Ping } from "ldrs/react"
import "ldrs/react/Ping.css"
import { RUN_STATE_COLOR, RUN_STATE_TEXT, type RunState } from "@/lib/run-state"
import { cn } from "@/lib/utils"

/**
 * SessionStateDot —— 会话运行态灯,词表色表(@/lib/run-state)的圆点渲染。
 * 未连接(无运行态 = 历史/未在 Runtime 活跃的会话)**不显灯**:只有活跃会话才有态,
 * 历史行不该挂灰点(Sessions / Collection / Active 三栏一致)。
 * 位置约定:会话行统一放**行首**(左侧,与图标同一根轨);定位方式由调用方容器决定。
 *
 * @param pulse working 态是否脉动(默认 true)。静态图例(如 navigator 的过滤 chip)传 false 关掉。
 */
export function SessionStateDot({
  state,
  className,
  pulse = true
}: {
  state?: RunState
  className?: string
  pulse?: boolean
}) {
  // 未连接 / 未运行:无态即不渲染灰点(历史会话行保持干净)。
  if (state === undefined) return null
  const color = RUN_STATE_COLOR[state]
  // working 运行态:黄色 ldrs ping(径向脉冲)替代原来的 animate-pulse 圆点。
  // pulse=false 的静态图例(navigator 过滤 chip 等)仍走普通黄点,不动画。
  if (state === "running" && pulse) {
    // running:统一观感(不跟调用方 size 变)——固定 6px 实心中心 + 26px ldrs ping 外圈脉冲。
    // ldrs ping 本身只有向外扩散的环、没有实心中心,中心自己补;中心太大会盖住脉冲,故固定小。
    // 中心与环同色(currentColor ← text-yellow-500,单一取色)。
    return (
      <span
        className={cn(
          "relative inline-flex size-1.5 shrink-0 items-center justify-center",
          RUN_STATE_TEXT.running,
          className
        )}>
        <span className="absolute inset-0 flex items-center justify-center">
          <Ping size="26" speed="2" color="currentColor" />
        </span>
        <span className="relative size-1.5 rounded-full bg-current" />
      </span>
    )
  }
  return <span className={cn("size-2 shrink-0 rounded-full", color, className)} />
}
