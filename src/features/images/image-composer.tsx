import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTools
} from "@alwith/module-chat/composer"
import { PromptInputAttachment, PromptInputAttachments } from "@alwith/module-chat/composer-attachments"
import { type Attachment, PromptInputProvider, usePromptInputAttachments } from "@alwith/module-chat/composer-context"
import { PromptInputTextarea } from "@alwith/module-chat/composer-textarea"
import { PlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ImageRequestAspect } from "@/agent/image-request"
import { nativeAttachmentPolicy } from "@/features/chat/composer/native-file-drop"
import { cn } from "@/lib/utils"

import { ImageAspectSelect } from "./aspect-select"
import { ImageModelSelect } from "./model-select"

function AttachImages({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton
      aria-label={t("images.addReference")}
      title={t("images.addReference")}
      disabled={disabled}
      onClick={() => attachments.openFileDialog()}
    >
      <PlusIcon className="size-4" />
    </PromptInputButton>
  )
}

/** The image surface composes the same input primitives and toolbar as ordinary chat. */
export function ImageComposer({
  text,
  onTextChange,
  attachments,
  onAttachmentsChange,
  ready,
  sending,
  aspectRatio,
  onAspectRatioChange,
  className,
  onSubmit,
  onError
}: {
  text: string
  onTextChange: (text: string) => void
  attachments: Attachment[]
  onAttachmentsChange: (attachments: Attachment[]) => void
  ready: boolean
  sending: boolean
  aspectRatio: ImageRequestAspect
  onAspectRatioChange: (value: ImageRequestAspect) => void
  className?: string
  onSubmit: (message: PromptInputMessage) => Promise<void>
  onError: (error: unknown) => void
}) {
  const { t } = useTranslation()
  return (
    <div data-chat-drop-zone className={cn("mx-auto w-full max-w-3xl px-6 pb-5", className)}>
      <PromptInputProvider
        value={text}
        onValueChange={onTextChange}
        attachments={attachments}
        onAttachmentsChange={onAttachmentsChange}
        attachmentPolicy={nativeAttachmentPolicy}
      >
        <PromptInput
          multiple
          accept="image/png,image/jpeg,image/webp"
          maxFileSize={8 * 1024 * 1024}
          attachmentPolicy={nativeAttachmentPolicy}
          onSubmit={onSubmit}
          onSubmitAsync={onSubmit}
          onSubmitError={onError}
          canSubmit={() => (ready && text.trim() ? true : "image_not_ready")}
          onError={() => onError(new Error(t("images.invalidFile")))}
        >
          <PromptInputHeader className="px-3 pt-3 pb-0 empty:hidden">
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} t={(key) => t(key, { ns: "alwithChat" })} />}
            </PromptInputAttachments>
          </PromptInputHeader>
          <PromptInputBody className="mb-0 min-h-16 px-3 pt-4 pb-2">
            <PromptInputTextarea
              className="min-h-10 bg-transparent text-sm font-normal"
              rows={2}
              placeholder={t("images.prompt")}
              aria-label={t("images.prompt")}
            />
          </PromptInputBody>
          <PromptInputFooter className="chat-composer-toolbar @container/input-footer mt-0 mb-2 w-full min-w-0 p-0">
            <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-[5px] px-2">
              <PromptInputTools>
                <AttachImages disabled={sending} />
                <ImageAspectSelect value={aspectRatio} onChange={onAspectRatioChange} disabled={sending} />
              </PromptInputTools>
              <PromptInputTools className="min-w-0 justify-end">
                <ImageModelSelect />
                <PromptInputSubmit
                  type="submit"
                  status={sending ? "submitted" : "ready"}
                  aria-label={t("images.generate")}
                  title={t("images.generate")}
                  disabled={!ready || !text.trim()}
                />
              </PromptInputTools>
            </div>
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}
