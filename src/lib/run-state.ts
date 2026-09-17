/**
 * 会话运行态词表(ALwith Desktop `lib/run-state.ts`)的唯一实现:
 * requires_action 红 / running 黄脉动 / done 蓝 / idle 绿。
 *
 * 词表对齐 ACP v2 的 `StateUpdate`(`running` / `idle` / `requires_action`)—— 那三个是 agent 直报的
 * 协议态;`done`(完成没人看)是 Runtime 合成的产品态,协议里没有,只由 `markRead` 消费。
 * 所有表面一律从这里取色与优先级,禁止各自写色值、各自排优先级、各自造词表外的状态名。
 */
import type { RunState } from "@alwith/api"

export type { RunState }

/** 圆点 / 状态条底色。 */
export const RUN_STATE_COLOR: Record<RunState, string> = {
  requires_action: "bg-red-500",
  running: "bg-yellow-500",
  done: "bg-blue-500",
  idle: "bg-green-500"
}

/** 文字/描边色。 */
export const RUN_STATE_TEXT: Record<RunState, string> = {
  requires_action: "text-red-500",
  running: "text-yellow-500",
  done: "text-blue-500",
  idle: "text-green-500"
}
