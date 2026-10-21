import { type ReactNode, useEffect, useRef } from "react"

/** Retain real amplitude samples while moving the history from right to left. */
export function VoiceWaveform({ audioLevel }: { audioLevel: number }): ReactNode {
  const latest = useRef(audioLevel)
  latest.current = audioLevel
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const element = svg.current
    if (element === null) throw new Error("waveform_not_mounted")
    const bars = [...element.querySelectorAll("rect")]
    const levels = bars.map(() => 0)
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    const sampleDuration = 300
    // Start from the animation timeline itself; do not mix clock origins.
    let previous: number | null = null
    let frame: number
    const draw = (now: number): void => {
      previous ??= now
      const steps = Math.floor((now - previous) / sampleDuration)
      if (steps > 0) {
        for (let index = 0; index < Math.min(steps, levels.length); index++) {
          levels.shift()
          levels.push(latest.current)
        }
        previous += steps * sampleDuration
      }
      const offset = reduced.matches ? 0 : ((now - previous) / sampleDuration) * 6
      bars.forEach((bar, index) => {
        // Map -50…-12 dBFS across the display instead of saturating on ordinary speech.
        const decibels = levels[index] === 0 ? -50 : 20 * Math.log10(levels[index])
        const intensity = Math.max(0, Math.min(1, (decibels + 50) / 38)) ** 1.25
        const height = 2 + 10 * intensity
        bar.setAttribute("x", String(index * 6 - offset))
        bar.setAttribute("y", String((12 - height) / 2))
        bar.setAttribute("height", String(height))
        bar.setAttribute("opacity", String(0.12 + 0.88 * intensity))
      })
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <svg
      ref={svg}
      className="voice-waveform-bars"
      viewBox="0 0 72 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-voice-level={audioLevel}
    >
      {Array.from({ length: 13 }, (_, position) => position * 6).map((position) => (
        <rect key={position} x={position} y="5" width="2" height="2" rx="1" opacity="0.12" />
      ))}
    </svg>
  )
}
