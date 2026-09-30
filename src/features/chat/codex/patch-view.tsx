import { PatchView as SharedPatchView } from "@alwith/module-chat/patch-view"
import { useTheme } from "@/components/theme-provider"

export { patchStats } from "@alwith/module-chat/patch-view"
export function PatchView({ patch }: { patch: string }) {
  const { resolvedTheme } = useTheme()
  return <SharedPatchView patch={patch} theme={resolvedTheme} />
}
