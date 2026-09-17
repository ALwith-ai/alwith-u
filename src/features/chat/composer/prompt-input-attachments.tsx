import { useTranslation } from "react-i18next"
import {
  PromptInputAttachment as SharedAttachment,
  type PromptInputAttachmentProps as SharedAttachmentProps
} from "@alwith/module-chat/composer-attachments"
export { PromptInputAttachments, type PromptInputAttachmentsProps } from "@alwith/module-chat/composer-attachments"
export type PromptInputAttachmentProps = Omit<SharedAttachmentProps, "t">
export function PromptInputAttachment(props: PromptInputAttachmentProps) {
  const { t } = useTranslation()
  return <SharedAttachment {...props} t={key => t(`chat.${key}`)} />
}
