import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { openSettingsWindow } from "@/lib/window-manager"

import type { useImageAvailability } from "./availability"

export function ImageServiceNotice({ availability }: { availability: ReturnType<typeof useImageAvailability> }) {
  const { t } = useTranslation()
  if (availability.available) return null
  const open = (section: "provider" | "images") => {
    void openSettingsWindow(section).catch((error: unknown) => toast.error(String(error)))
  }
  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6" role="status">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>{t(availability.checking ? "images.checkingServices" : "images.connectServices")}</span>
        {!availability.checking && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => open("provider")}>
              {t("images.connectChatgpt")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => open("images")}>
              {t("images.configureSeedream")}
            </Button>
          </div>
        )}
      </div>
      {availability.error && (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("images.servicesCheckFailed")}</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => void availability.retry().catch((error: unknown) => toast.error(String(error)))}
          >
            {t("images.retry")}
          </Button>
        </div>
      )}
    </div>
  )
}
