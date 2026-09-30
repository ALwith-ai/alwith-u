/**
 * Mouse entry to the same command list: click opens the CompletionMenu without inserting
 * a `/`; choosing a command writes it into the input. From ALwith Desktop.
 */
import { SquareSlashIcon } from "lucide-react"
import { type RefObject, useRef } from "react"
import { useTranslation } from "react-i18next"
import { PromptInputButton, type PromptInputTextareaHandle } from "./prompt-input"

export function SlashCommandButton({
  textareaRef,
  onOpenChange,
  menuOpen,
  disabled
}: {
  textareaRef: RefObject<PromptInputTextareaHandle | null>
  onOpenChange: (open: boolean) => void
  menuOpen: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  // While the menu is open, outside-dismiss flips the state before click; snapshot on
  // pointerdown so the click toggles from what the user saw.
  const wasOpenRef = useRef(false)
  return (
    <PromptInputButton
      aria-label={t("chat.commands")}
      title={t("chat.commands")}
      disabled={disabled}
      aria-pressed={menuOpen}
      onPointerDown={() => {
        wasOpenRef.current = menuOpen
      }}
      onClick={() => {
        onOpenChange(!wasOpenRef.current)
        textareaRef.current?.getTextarea()?.focus()
      }}>
      <SquareSlashIcon className="size-4" />
    </PromptInputButton>
  )
}
