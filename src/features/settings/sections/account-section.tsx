import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { logoutPlatform, usePlatformAuth } from "@/features/auth/store"

export function AccountSection() {
  const { t } = useTranslation()
  const user = usePlatformAuth(state => state.user)
  const [busy, setBusy] = useState(false)
  if (!user) return null
  return (
    <section className="flex flex-col gap-4 pt-6">
      <h2 className="text-lg font-semibold">ALwith</h2>
      <p>{user.nickname}</p>
      <p className="text-muted-foreground text-sm">{user.login_email}</p>
      <p className="text-muted-foreground text-sm">{t("platformAuth.accountHint")}</p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void logoutPlatform()
            .catch(() => toast.error(t("platformAuth.failed")))
            .finally(() => setBusy(false))
        }}>
        {t("platformAuth.signOut")}
      </Button>
    </section>
  )
}
