/**
 * Single source of truth for session run states, adapted from ALwith Desktop's `lib/run-state.ts`:
 * requires_action: red / running: pulsing yellow / done: blue / idle: green.
 *
 * Aligns with ACP v2 `StateUpdate` (`running` / `idle` / `requires_action`), the three protocol states reported directly by agents.
 * `done` (completed but unread) is a Runtime-synthesized product state, absent from the protocol and cleared only by `markRead`.
 * All UI surfaces must use these colors and priorities rather than defining their own colors, ordering, or state names.
 */
import type { RunState } from "@alwith/api"

export type { RunState }

/** Background colors for dots and status bars. */
export const RUN_STATE_COLOR: Record<RunState, string> = {
  requires_action: "bg-red-500",
  running: "bg-yellow-500",
  done: "bg-blue-500",
  idle: "bg-green-500"
}

/** Text and outline colors. */
export const RUN_STATE_TEXT: Record<RunState, string> = {
  requires_action: "text-red-500",
  running: "text-yellow-500",
  done: "text-blue-500",
  idle: "text-green-500"
}
