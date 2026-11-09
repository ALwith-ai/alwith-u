import { ZoomFeedback } from "@alwith/module-desktop-shell/react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

/** Supply U's current language and error surface to the shared feedback. */
export function DesktopZoomFeedback({ showFeedback = true }: { showFeedback?: boolean }) {
  const { i18n } = useTranslation()
  return (
    <ZoomFeedback
      language={i18n.language}
      showFeedback={showFeedback}
      onError={(error) => toast.error(error instanceof Error ? error.message : String(error))}
    />
  )
}
