import { codexMessageError, codexTurnError } from "@/agent/codex-extensions"

import type { Turn } from "../turns"

const CAPACITY_RETRY_DELAYS = [10, 30, 120, 300]

/** Codex backs off across consecutive empty-input capacity continuations. */
export function capacityRetryDelay(turns: readonly Turn[]): number | null {
  let failures = 0
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]
    const item = turn.errors.at(-1)
    const error = item === undefined ? null : codexMessageError(item)
    if (error === null || codexTurnError(error).category !== "overloaded") break
    failures++
    if (turn.user !== null) break
  }
  return CAPACITY_RETRY_DELAYS[failures - 1] ?? null
}
