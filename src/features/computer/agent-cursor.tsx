import { cursorArtwork as art } from "./cursor-artwork"

/** Shares the hotspot, halo and geometry of the native compiled cursor theme. */
export function AgentCursor() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 128 128"
      width={art.size}
      height={art.size}
      className="computer-agent-cursor overflow-visible"
    >
      {art.haloRadii.map((radius) => (
        <circle key={radius} cx="64" cy="64" r={radius} fill="var(--computer-cursor-body)" opacity={art.haloOpacity} />
      ))}
      <polygon
        points={art.outline.map((point) => point.join(",")).join(" ")}
        fill="var(--computer-cursor-body)"
        stroke="var(--computer-cursor-outline)"
        strokeWidth={art.strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  )
}
