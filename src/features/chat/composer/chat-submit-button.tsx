/**
 * The submit button. Always "send": while a turn runs the prompt is steered into it, so the
 * button stays live; stopping is the neighbouring square button. From ALwith Desktop.
 */
import { SquareIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { PromptInputButton, PromptInputSubmit, usePromptInputController } from "./prompt-input"

export function ChatSubmitButton({
  active,
  sending,
  ready,
  onStop
}: {
  active: boolean
  sending: boolean
  ready: boolean
  onStop: () => void
}) {
  const { t } = useTranslation()
  const controller = usePromptInputController()
  const hasInput = controller.textInput.value.trim().length > 0 || controller.attachments.files.length > 0
  const disabled = !ready || sending || !hasInput
  return (
    <>
      {active && (
        <PromptInputButton
          aria-label={t("actions.stop")}
          title={t("actions.stop")}
          className="border-border size-7 rounded-full border"
          onClick={onStop}>
          <SquareIcon className="size-3 fill-current" />
        </PromptInputButton>
      )}
      <div className={cn(disabled && "cursor-not-allowed")}>
        <PromptInputSubmit
          aria-label={active ? t("actions.steer") : t("actions.send")}
          disabled={disabled}
          aria-busy={sending}
          status={sending ? "submitted" : "ready"}
        />
      </div>
    </>
  )
}
