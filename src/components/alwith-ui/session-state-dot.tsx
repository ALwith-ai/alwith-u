import { Ping } from "ldrs/react"
import "ldrs/react/Ping.css"
import { RUN_STATE_COLOR, RUN_STATE_TEXT, type RunState } from "@/lib/run-state"
import { cn } from "@/lib/utils"

/**
 * SessionStateDot renders a session state indicator using the vocabulary and colors from @/lib/run-state.
 * Disconnected sessions (no run state: historical sessions or sessions not active in Runtime) show no dot; only active sessions have a state.
 * Historical rows must not display a gray dot, consistently across Sessions / Collection / Active.
 * Place the dot at the start of each session row, on the left and aligned with icons; the caller controls positioning.
 *
 * @param pulse Whether the working state pulses (default true). Pass false for static legends such as navigator filter chips.
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
  // Disconnected / not running: no state means no gray dot, keeping historical session rows clean.
  if (state === undefined) return null
  const color = RUN_STATE_COLOR[state]
  // Working state: a yellow ldrs ping (radial pulse) replaces the previous animate-pulse dot.
  // Static legends with pulse=false, such as navigator filter chips, retain a plain yellow dot without animation.
  if (state === "running" && pulse) {
    // Running: use a fixed 6px solid center and 26px ldrs ping ring for a consistent appearance, independent of the caller's size.
    // ldrs ping only provides expanding rings, so add a solid center. Keep it small to avoid covering the pulse.
    // Center and ring share one color source (currentColor from text-yellow-500).
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
