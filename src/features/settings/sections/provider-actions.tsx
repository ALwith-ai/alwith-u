import { Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { ProviderTestResult } from "@/lib/providers"

function TestFeedback({ result }: { result: ProviderTestResult }) {
  const { t } = useTranslation()
  return (
    <p role="status" className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {result.ok
        ? t("provider.testSuccess", { latency: result.latencyMs ?? 0 })
        : `${t(`provider.testErrors.${result.code}`)}${result.status ? ` (HTTP ${result.status})` : ""}`}
    </p>
  )
}

export type ProviderOperation = "test" | "save" | "remove"

export function ProviderActions({
  busy,
  operation,
  canTest,
  onTest,
  onRemove,
  result,
  testDescription,
  children
}: {
  busy: boolean
  operation?: ProviderOperation
  canTest: boolean
  onTest?: () => void
  onRemove?: () => void
  result?: ProviderTestResult
  testDescription?: string
  children: ReactNode
}): ReactNode {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 border-t pt-4">
      {result && <TestFeedback result={result} />}
      {onTest && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {testDescription ?? t("provider.testDescription")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {onRemove && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="font-normal"
            disabled={busy}
            aria-busy={operation === "remove"}
            onClick={onRemove}
          >
            {operation === "remove" ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Trash2Icon className="size-4" />}
            {t("provider.remove")}
          </Button>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {onTest && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !canTest}
              aria-busy={operation === "test"}
              onClick={onTest}
            >
              {operation === "test" && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {t("provider.testButton")}
            </Button>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
