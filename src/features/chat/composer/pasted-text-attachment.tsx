import { FileText, RotateCcw, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useOpenChatLink } from "../file-actions"
import { type PastedTextAttachment as PastedTextFile, writePastedTextAttachment } from "./long-text"
import { usePromptInputAttachments } from "./prompt-input-context"

export function PastedTextAttachment({ data, sessionId }: { data: PastedTextFile; sessionId: string }) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  const openLink = useOpenChatLink()
  const { text, status } = data.pastedText
  return (
    <div className="bg-muted flex max-w-64 min-w-0 items-center gap-1 rounded-lg px-2 py-1">
      <Button
        type="button"
        variant="ghost"
        disabled={status !== "ready"}
        onClick={() => openLink(data.url)}
        className="h-auto min-w-0 flex-1 shrink gap-2 overflow-hidden px-0 py-1">
        <FileText className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 text-start">
          <span className="block truncate text-xs">{data.filename}</span>
          <span className="text-muted-foreground block text-xs">
            {status === "ready"
              ? t("chat.pastedText.characters", { count: text.length })
              : t(`chat.pastedText.${status}`)}
          </span>
        </span>
      </Button>
      {status === "error" && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("chat.pastedText.retry")}
          onClick={() => writePastedTextAttachment(sessionId, data)}>
          <RotateCcw className="size-3" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("chat.pastedText.remove")}
        onClick={() => attachments.remove(data.id)}>
        <X className="size-3" />
      </Button>
    </div>
  )
}
