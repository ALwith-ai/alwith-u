import { PatchView as SharedPatchView } from "@alwith/chat/patch-view"
import { useTheme } from "@/components/theme-provider"
export { patchStats } from "@alwith/chat/patch-view"
export function PatchView({ patch }: { patch: string }) {
  const { resolvedTheme } = useTheme()
  return <SharedPatchView patch={patch} theme={resolvedTheme} />
}
