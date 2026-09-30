import type { ExtensionHost, ViewContribution } from "@alwith/module-extension/host"
import { ExtensionView, useHostSnapshot } from "@alwith/module-extension/react"
import { type ReactElement, useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { reportExtensionError, useExtensions } from "./runtime"

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
  onError(error: unknown): void
}): ReactElement {
  const { t } = useTranslation()
  const snapshot = useHostSnapshot(host)
  const view = snapshot.views.find(item => item.id === id)
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
          <Button variant="outline" size="xs" onClick={() => setFailure(null)}>
            {t("actions.retry")}
          </Button>
        </div>
      )}
      <div ref={setContainer} className="flex min-h-0 min-w-0 flex-1 flex-col" />
      {view && !failed && <ExtensionView host={host} id={id} container={container} onError={handleError} />}
    </div>
  )
}

export function ExtensionPage({ id, onClose }: { id: string; onClose(): void }): ReactElement {
  const { t } = useTranslation()
  const { host } = useExtensions()
  const view = host.views.find(item => item.id === id && (item.kind === "surfaces" || item.kind === "settingsPages"))
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 pt-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">{view?.title ?? t("extensions.unavailable")}</h1>
        <Button variant="outline" onClick={onClose}>
          {t("extensions.back")}
        </Button>
      </div>
      {view && <ExtensionMount key={id} id={id} />}
    </section>
  )
}
