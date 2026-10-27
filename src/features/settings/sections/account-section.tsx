import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { logoutPlatform, usePlatformAuth } from "@/features/auth/store"
import { PhoneLoginView } from "@/features/mobile/phone-login-view"

import { SettingGroup, SettingRow } from "./shared"

export function AccountSection({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { t } = useTranslation()
  const user = usePlatformAuth((state) => state.user)
  const [loggingIn, setLoggingIn] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!user) return null
  return (
    <div className="space-y-6">
      <SettingGroup>
        <SettingRow title={user.nickname} desc={user.login_email}>
          <Button
            className="rounded-sm"
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
      <SettingGroup>
        <SettingRow title={t("mobile.login.title")} desc={t("mobile.login.subtitle")}>
          {!loggingIn && (
            <Button className="rounded-sm" variant="outline" onClick={() => setLoggingIn(true)}>
              {t("mobile.login.action")}
            </Button>
          )}
        </SettingRow>
        {loggingIn && <PhoneLoginView onBack={() => setLoggingIn(false)} onContinue={onOpenMobile} />}
      </SettingGroup>
    </div>
  )
}
