import type { SessionRunState } from "@alwith/api"
const sources = new WeakMap<Record<string, SessionRunState>, "snapshot" | "event">()
export function setRunStateSource(states: Record<string, SessionRunState>, source: "snapshot" | "event"): void {
  sources.set(states, source)
}
export function runStateSource(states: Record<string, SessionRunState>): "snapshot" | "event" {
  return sources.get(states) ?? "snapshot"
}
