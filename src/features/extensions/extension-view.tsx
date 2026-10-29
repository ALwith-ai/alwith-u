import type { ExtensionHost, ViewContribution } from "@alwith/module-extension/host"
import { ExtensionView, useHostSnapshot } from "@alwith/module-extension/react"
import { type ReactElement, useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { CatalogHeader } from "@/components/alwith-ui/catalog-header"
import { toolboxContentClassName, ToolboxPageHeader } from "@/components/alwith-ui/toolbox-layout"
import { Button } from "@/components/ui/button"

import { ExtensionSettingsControls } from "./extension-settings-controls"
import { openExtensionConsent } from "./legacy/startup-consent"
import { reportExtensionError } from "./runtime"
import { useExtensions } from "./use-extensions"

export function ExtensionMount({ id }: { id: string }): ReactElement {
  const { runtime } = useExtensions()
  return <ExtensionViewContent host={runtime.host} id={id} onError={reportExtensionError} />
}

export function ExtensionViewContent({
  host,
  id,
  onError
}: {
  host: ExtensionHost
  id: string
  onError: (error: unknown) => void
}): ReactElement {
  const { t } = useTranslation()
  const snapshot = useHostSnapshot(host)
  const view = snapshot.views.find((item) => item.id === id)
  useEffect(() => {
    if (view?.kind === "surfaces" || view?.kind === "settingsPages") {
      void openExtensionConsent(view.extensionId).catch(onError)
    }
  }, [view?.extensionId, view?.kind, onError])
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [failure, setFailure] = useState<{ view: ViewContribution | undefined; error: unknown } | null>(null)
  const failed = failure !== null && failure.view === view
  const handleError = useCallback(
    (error: unknown): void => {
      setFailure({ view, error })
      onError(error)
    },
    [view, onError]
  )
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {failed && (
        <div role="alert" className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate" title={String(failure.error)}>
            {String(failure.error)}
          </span>
          <Button variant="outline" size="xs" className="h-9" onClick={() => setFailure(null)}>
            {t("actions.retry")}
          </Button>
        </div>
      )}
      <div ref={setContainer} className="flex min-h-0 min-w-0 flex-1 flex-col" />
      {container && (view?.kind === "settingsPages" || view?.kind === "settings") && (
        <ExtensionSettingsControls container={container} />
      )}
      {view && !failed && <ExtensionView host={host} id={id} container={container} onError={handleError} />}
    </div>
  )
}

export function ExtensionPage({ id, onClose }: { id: string; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const { host } = useExtensions()
  const view = host.views.find((item) => item.id === id && (item.kind === "surfaces" || item.kind === "settingsPages"))
  return (
    <section className="toolbox-extension-page toolbox-surface @container flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolboxPageHeader>
        <CatalogHeader title={view?.title ?? t("extensions.unavailable")}>
          <Button variant="outline" size="sm" className="h-9" onClick={onClose}>
            {t("extensions.back")}
          </Button>
        </CatalogHeader>
      </ToolboxPageHeader>
      <div className={`${toolboxContentClassName} toolbox-extension-surface flex min-h-0 flex-1 flex-col pt-6`}>
        {view && <ExtensionMount key={id} id={id} />}
      </div>
    </section>
  )
}
