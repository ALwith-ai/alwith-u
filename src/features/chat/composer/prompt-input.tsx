/** Desktop chat form; U supplies application error feedback, not another form implementation. */
import {
  PromptInput as SharedPromptInput,
  type PromptInputProps as SharedPromptInputProps
} from "@alwith/module-chat/composer"
import { toast } from "sonner"
export * from "@alwith/module-chat/composer"
export {
  type Attachment,
  type AttachmentsContext,
  type FileUIPart,
  type PromptInputControllerProps,
  PromptInputProvider,
  type PromptInputProviderProps,
  type TextInputContext,
  usePromptInputAttachments,
  usePromptInputController
} from "./prompt-input-context"
export {
  PromptInputTextarea,
  type PromptInputTextareaHandle,
  type PromptInputTextareaProps
} from "./prompt-input-textarea"

export type PromptInputProps = Omit<
  SharedPromptInputProps,
  "onSubmitError" | "onCommand" | "bashMode" | "attachmentPolicy"
>
function onSubmitError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error))
}
export function PromptInput(props: PromptInputProps) {
  return <SharedPromptInput {...props} onSubmitError={onSubmitError} />
}
