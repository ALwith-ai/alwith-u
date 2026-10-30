// ALwith Desktop's `activity-group.ts` without the `dev` (execution lease) bucket: this
// client has no ALwith.dev, so a running session is either the one on screen or background.
export type ActivityGroup = "foreground" | "background"

export function activityGroupOf({ visible }: { visible: boolean }): ActivityGroup {
  if (visible) return "foreground"
  return "background"
}
