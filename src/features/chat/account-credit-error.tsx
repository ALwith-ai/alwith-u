import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { openPlatformTopUp } from "@/features/auth/open-account"

/** Only the account-managed LiteLLM route can offer ALwith recharge. */
export function isAccountCreditError(model: string | null | undefined, message: string): boolean {
  return (
    /^(?:gateway:)(?:litellm|alwith-managed-litellm):.+/.test(model ?? "") && /\binsufficient credits\b/i.test(message)
  )
}

export function AccountCreditError() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  async function recharge(): Promise<void> {
    setBusy(true)
    try {
      await openPlatformTopUp()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>{t("chat.accountCreditError")}</span>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void recharge()}>
        {t("provider.managed.topUp")}
      </Button>
    </div>
  )
}
