/**
 * The chat input area, ALwith Desktop's InputArea reduced for Codex: attachments header,
 * textarea, footer with slash commands, permission mode, model menu and send/stop. Drafts
 * (text and image attachments) are kept per session for the life of the webview.
 */
import type * as acp from "@agentclientprotocol/sdk/experimental/v2"
import type { Session } from "@alwith/api"
import { ImageIcon } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { hasFuzzyFileSearch } from "@/agent/codex-extensions"
import { client, useApp } from "@/lib/client"
import { ChatSubmitButton } from "./composer/chat-submit-button"
import { CompletionMenu } from "./composer/completion-menu"
import { drafts, registerComposerWriter } from "./composer/drafts"
import { MentionChips } from "./composer/mention-chips"
import { formatMentionUri, mentionDisplayName } from "./composer/mention-uri"
import { ModelSelectGroup } from "./composer/model-select-group"
import { PermissionModeSelect } from "./composer/permission-mode-select"
import {
  type Attachment,
  type FileUIPart,
  MAX_TOTAL_IMAGE_MB,
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  type PromptInputButtonProps,
  type PromptInputError,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputTextarea,
  type PromptInputTextareaHandle,
  PromptInputTools,
  usePromptInputAttachments
} from "./composer/prompt-input"
import { PromptInputAttachment, PromptInputAttachments } from "./composer/prompt-input-attachments"
import { SlashCommandButton } from "./composer/slash-command-button"
import { UsageMeter } from "./usage-meter"

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]

const EMPTY_ATTACHMENTS: Attachment[] = []

async function readBase64(attachment: FileUIPart): Promise<string> {
  const blob = await (await fetch(attachment.url)).blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(",") + 1))
    }
    reader.readAsDataURL(blob)
  })
}

function AttachImageButton(props: Omit<PromptInputButtonProps, "onClick">) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  return (
    <PromptInputButton
      aria-label={t("chat.attachImage")}
      title={t("chat.attachImage")}
      onClick={() => attachments.openFileDialog()}
      {...props}>
      <ImageIcon className="size-4" />
    </PromptInputButton>
  )
}

export function Composer({
  session,
  onSubmit,
  modelSelector,
  inputHeader,
  disabled = false,
  preparing = false,
  allowPendingInput = false
}: {
  session: Session
  disabled?: boolean
  preparing?: boolean
  /** Draft input stays editable while session preparation blocks submission. */
  allowPendingInput?: boolean
  /** The draft surface owns the transition after the first prompt is accepted. */
  onSubmit?: (prompt: acp.ContentBlock[]) => Promise<void>
  /** Before session/new, the host owns the initial model selection. */
  modelSelector?: import("react").ReactNode
  inputHeader?: import("react").ReactNode
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(() => drafts.get(session.id)?.text ?? "")
  const [attachments, setAttachments] = useState<Attachment[]>(
    () => drafts.get(session.id)?.attachments ?? EMPTY_ATTACHMENTS
  )
  const [mentions, setMentions] = useState<string[]>(() => drafts.get(session.id)?.mentions ?? [])
  const [sending, setSending] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const textareaRef = useRef<PromptInputTextareaHandle>(null)
  const inputAreaRef = useRef<HTMLDivElement>(null)
  const active = session.state !== "idle"
  const ready = !disabled && !preparing && session.attached && !session.restoring && !session.readOnly
  const inputReady = !session.readOnly && (allowPendingInput || ready)

  useEffect(() => {
    drafts.set(session.id, { text, attachments, mentions, modelId: drafts.get(session.id)?.modelId ?? null })
  }, [session.id, text, attachments, mentions])

  useLayoutEffect(
    () =>
      registerComposerWriter(session.id, value => {
        if (!inputReady || sending) throw new Error("当前输入框不可写，请稍后重试")
        if (text.length || attachments.length || mentions.length)
          throw new Error("输入框已有草稿，请先发送或清空后重试")
        setText(value)
      }),
    [session.id, inputReady, sending, text, attachments, mentions]
  )

  const fileSearchAvailable = useApp(state => hasFuzzyFileSearch(state.agent))
  const searchFiles = useMemo(
    () =>
      fileSearchAvailable && ready
        ? async (query: string) => (await client.fuzzyFileSearch({ query, roots: [session.cwd] })).files
        : undefined,
    [fileSearchAvailable, ready, session.cwd]
  )
  const addMention = useCallback((path: string) => {
    setMentions(current => (current.includes(path) ? current : [...current, path]))
  }, [])

  // Mounted per session (ChatView is keyed): focus on arrival.
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = useCallback(
    async ({ text: input, files }: PromptInputMessage) => {
      const trimmed = input.trim()
      if (trimmed.length === 0 && files.length === 0) return
      const prompt: acp.ContentBlock[] = []
      // Mentions go first as ACP embedded context, the way ALwith Desktop sends them.
      for (const path of mentions) {
        const mention = { kind: "file", absPath: path } as const
        prompt.push({ type: "resource_link", uri: formatMentionUri(mention), name: mentionDisplayName(mention) })
      }
      if (trimmed.length > 0) prompt.push({ type: "text", text: trimmed })
      for (const file of files) prompt.push({ type: "image", data: await readBase64(file), mimeType: file.mediaType })
      setSending(true)
      try {
        if (onSubmit) await onSubmit(prompt)
        else await client.prompt(session.id, prompt)
        setMentions([])
        textareaRef.current?.resetHeight()
      } finally {
        setSending(false)
        textareaRef.current?.focus()
      }
    },
    [session.id, mentions, onSubmit]
  )

  const stop = () => {
    client
      .cancel(session.id)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }

  const onAttachmentError = useCallback(
    (error: PromptInputError) => {
      if (error.code === "max_total_size") {
        toast.error(t("chat.input.imageTooLargeTitle"), {
          description: t("chat.input.imageTooLargeDesc", { mb: MAX_TOTAL_IMAGE_MB })
        })
        return
      }
      toast.error(t("chat.input.unsupportedAttachmentTitle"), {
        description: t("chat.input.unsupportedAttachmentDesc")
      })
    },
    [t]
  )

  return (
    <div className="relative mx-auto w-full max-w-3xl px-6 pb-5" ref={inputAreaRef}>
      {inputHeader && (
        <div
          data-chat-input-header
          className="bg-sidebar dark:bg-foreground/3 relative top-1 z-0 mx-[13px] -mb-[18px] flex min-w-0 items-center gap-2 overflow-hidden rounded-t-2xl px-1.5 pt-1.5 pb-[27px]">
          {inputHeader}
        </div>
      )}
      <PromptInputProvider
        value={text}
        onValueChange={setText}
        attachments={attachments}
        onAttachmentsChange={setAttachments}>
        <CompletionMenu
          handleRef={textareaRef}
          commands={session.commands}
          searchFiles={searchFiles}
          onMention={addMention}
          forcedOpen={slashMenuOpen}
          onForcedOpenChange={setSlashMenuOpen}
        />
        <PromptInput
          globalDrop
          multiple
          accept={IMAGE_TYPES.join(",")}
          onError={onAttachmentError}
          onSubmit={submit}
          onSubmitCapture={event => {
            if (!ready || sending) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}
          className="relative z-10">
          <PromptInputHeader>
            <MentionChips
              mentions={mentions}
              onRemove={path => setMentions(current => current.filter(item => item !== path))}
            />
            <PromptInputAttachments>{attachment => <PromptInputAttachment data={attachment} />}</PromptInputAttachments>
          </PromptInputHeader>
          <PromptInputBody className="mb-1 min-h-10 px-3">
            <PromptInputTextarea
              className="min-h-10"
              ref={textareaRef}
              rows={2}
              disabled={!inputReady}
              placeholder={active ? t("chat.steerPlaceholder") : t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
            />
          </PromptInputBody>
          <PromptInputFooter className="@container/input-footer mt-0 mb-2 w-full min-w-0 p-0">
            <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-[5px] px-2">
              <div className="flex min-w-0 items-center gap-[5px]">
                <SlashCommandButton
                  textareaRef={textareaRef}
                  menuOpen={slashMenuOpen}
                  onOpenChange={setSlashMenuOpen}
                  disabled={!ready || session.commands.length === 0}
                />
                <AttachImageButton disabled={!inputReady} />
                <PermissionModeSelect sessionId={session.id} options={session.configOptions} disabled={!ready} />
              </div>
              <PromptInputTools className="w-full min-w-0 items-center justify-end gap-1">
                <UsageMeter session={session} />
                {modelSelector ?? (
                  <ModelSelectGroup sessionId={session.id} options={session.configOptions} disabled={!ready} />
                )}
                <ChatSubmitButton active={active} sending={sending || preparing} ready={ready} onStop={stop} />
              </PromptInputTools>
            </div>
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  )
}
