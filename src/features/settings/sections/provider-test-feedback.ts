import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { describeProviderError, logProviderError } from "@/lib/provider-errors"
import type { ProviderTestResult } from "@/lib/providers"

export function useProviderTestFeedback() {
  const { t } = useTranslation()
  return {
    result(result: ProviderTestResult) {
      if (result.ok) toast.success(t("provider.testSuccess", { latency: result.latencyMs ?? 0 }))
      else {
        logProviderError("test", result)
        toast.error(
          `${t(`provider.testErrors.${result.code}`)}${result.message ? `: ${describeProviderError(result.message)}` : ""}`
        )
      }
    },
    error(error: unknown) {
      logProviderError("test", error)
      toast.error(describeProviderError(error))
    }
  }
}
