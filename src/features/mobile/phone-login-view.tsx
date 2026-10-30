import { usePhoneLoginTicket } from "@alwith/module-auth/phone-login"
import { SmartphoneIcon } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { platformApiRequest } from "@/features/auth/store"

const apiPost = <T,>(path: string, body?: unknown): Promise<T> => platformApiRequest(path, "POST", body)

export function PhoneLoginView({ onBack, onContinue }: { onBack: () => void; onContinue?: () => void }) {
  const { t } = useTranslation()
  const { state, refresh, confirm } = usePhoneLoginTicket({ apiPost })

  return (
    <>
      <div className="mt-8 flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border px-5 py-8">
        {state.phase === "creating" && <Spinner className="size-6 text-muted-foreground" />}

        {state.phase === "showing" && (
          <>
            <p className="text-center text-sm text-muted-foreground">{t("mobile.login.scanHint")}</p>
            <div className="rounded-xl bg-background p-3">
              <QRCodeSVG
                size={180}
                marginSize={4}
                bgColor="transparent"
                fgColor="currentColor"
                value={state.qrContent}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {t("mobile.login.expires", { seconds: state.secondsLeft })}
            </div>
          </>
        )}

        {state.phase === "expired" && (
          <>
            <div className="text-sm text-muted-foreground">{t("mobile.login.expired")}</div>
            <Button className="rounded-sm" variant="outline" onClick={refresh}>
              {t("mobile.login.refresh")}
            </Button>
          </>
        )}

        {(state.phase === "scanned" || state.phase === "confirming") && (
          <>
            <div className="flex items-center gap-3">
              <SmartphoneIcon className="size-8 text-muted-foreground" />
              <div>
                <div className="text-[15px] font-medium">{state.deviceName}</div>
                <div className="font-mono text-xs text-muted-foreground">{state.deviceId.slice(0, 8)}</div>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">{t("mobile.login.scannedHint")}</div>
            {state.phase === "scanned" && state.confirmError !== null && (
              <div className="text-xs break-all text-muted-foreground">{state.confirmError}</div>
            )}
            <div className="flex items-center gap-2">
              <Button className="rounded-sm" onClick={confirm} disabled={state.phase === "confirming"}>
                {state.phase === "confirming" && <Spinner data-icon="inline-start" />}
                {t("mobile.login.confirm")}
              </Button>
              <Button
                className="rounded-sm"
                variant="outline"
                onClick={refresh}
                disabled={state.phase === "confirming"}
              >
                {t("mobile.login.refresh")}
              </Button>
            </div>
          </>
        )}

        {state.phase === "confirmed" && (
          <>
            <div className="text-[15px]">{t("mobile.login.confirmed")}</div>
            <p className="text-center text-sm text-muted-foreground">{t("mobile.login.nextHint")}</p>
            {onContinue && (
              <Button className="rounded-sm" variant="outline" onClick={onContinue}>
                {t("mobile.login.continue")}
              </Button>
            )}
            <Button className="rounded-sm" variant="outline" onClick={refresh}>
              {t("mobile.login.again")}
            </Button>
          </>
        )}

        {state.phase === "error" && (
          <>
            <div className="max-w-md text-center text-xs break-all text-muted-foreground">{state.message}</div>
            <Button className="rounded-sm" variant="outline" onClick={refresh}>
              {t("mobile.login.retry")}
            </Button>
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button className="rounded-sm" variant="outline" onClick={onBack}>
          {t("mobile.login.back")}
        </Button>
      </div>
    </>
  )
}
