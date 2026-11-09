import { type DriveContentHost, drivePreviewIntegrations } from "@alwith/module-drive/content"
import type { EditorDocument, PreviewContext, PreviewProvider } from "@alwith/module-editor"
import { createPreviewProviders, type PreviewHost } from "@alwith/module-editor/previews"
import { containsPath } from "@alwith/module-fs/core"
import { type ReactNode, useState } from "react"

import { drive } from "./controller"

function ScopedPreview({
  document,
  context,
  local,
  managed
}: {
  document: EditorDocument
  context: PreviewContext
  local: PreviewProvider
  managed: PreviewProvider
}): ReactNode {
  // Keep an existing collaboration integration alive so its stop/profile fencing handles transitions.
  // A preview opened locally stays local until reopened; synchronization never becomes its prerequisite.
  const [collaborative] = useState(() => {
    const { connected, snapshot } = drive.getSnapshot()
    return Boolean(
      connected &&
      snapshot?.running &&
      snapshot.roots.some((root) => root.drivePath && containsPath(root.localPath, document.path))
    )
  })
  return (collaborative ? managed : local).render(document, context)
}

/** Select integrations per document, including simultaneous previews in split editor panes. */
export function scopedDrivePreviewProviders(host: PreviewHost, contentHost: DriveContentHost): PreviewProvider[] {
  const managed = createPreviewProviders({ ...host, ...drivePreviewIntegrations(contentHost) })
  return createPreviewProviders(host).map((local) => {
    const integrated = managed.find((provider) => provider.id === local.id)
    if (!integrated) throw new Error(`Missing Drive preview provider: ${local.id}`)
    return {
      ...local,
      render: (document, context) => (
        <ScopedPreview key={document.id} document={document} context={context} local={local} managed={integrated} />
      )
    }
  })
}
