import { CircleHelpIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { openGuideWindow } from "./guide-window"

export function GuideButton() {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label={t("guide.title")}
      title={t("guide.title")}
      onClick={() =>
        void openGuideWindow().catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : String(error))
        )
      }>
      <CircleHelpIcon />
    </Button>
  )
}
