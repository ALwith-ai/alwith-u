import { type ExtensionManifest, resolveManifestText } from "@alwith/module-extension"
import { type ActionContribution, type HostSnapshot, sortContributions } from "@alwith/module-extension/host"

/** Both launchers require an entry action and a content surface from the same app. */
export function extensionApps(
  host: HostSnapshot,
  manifests: ExtensionManifest[],
  language: string
): Array<{ action: ActionContribution; name: string }> {
  const actions = sortContributions(
    host.actions.filter(
      (action) =>
        (action.placement === "topBar" || action.placement === "navigation") &&
        host.views.some((view) => view.extensionId === action.extensionId && view.kind === "surfaces")
    )
  )
  return actions
    .filter((action, index) => actions.findIndex((item) => item.extensionId === action.extensionId) === index)
    .map((action) => {
      const manifest = manifests.find((item) => item.id === action.extensionId)
      if (!manifest) throw new Error(`Extension manifest unavailable: ${action.extensionId}`)
      return { action, name: resolveManifestText(manifest, language).name }
    })
}
