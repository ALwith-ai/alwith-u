import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { logoutPlatform, usePlatformAuth } from "@/features/auth/store"

import { SettingGroup, SettingRow } from "./shared"

export function AccountSection() {
  const { t } = useTranslation()
  const user = usePlatformAuth((state) => state.user)
  const [busy, setBusy] = useState(false)
  if (!user) return null
  return (
    <SettingGroup>
      <SettingRow title={user.nickname} desc={user.login_email}>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void logoutPlatform()
              .catch(() => toast.error(t("platformAuth.failed")))
              .finally(() => setBusy(false))
          }}
        >
          {t("platformAuth.signOut")}
        </Button>
      </SettingRow>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("platformAuth.accountHint")}</p>
    </SettingGroup>
  )
}
