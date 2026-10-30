import { resolveSplitGeometry } from "@nyssance/atlas/layout"

type CanvasRegion = "leading" | "chat" | "preview" | "trailing"

export function resolveMainCanvasGeometry(input: Parameters<typeof resolveSplitGeometry>[0], trailing: boolean) {
  const base = resolveSplitGeometry(input)
  const regions: CanvasRegion[] = base.stops.length > 2 ? ["leading", "chat", "preview"] : ["leading", "chat"]
  const stops = [...base.stops]
  if (trailing) {
    regions.push("trailing")
    stops.push(base.leading + input.navigation + base.content + input.navigation - input.viewport)
  }
  return { ...base, stops, regions, split: base.stops.length > 2 }
}
