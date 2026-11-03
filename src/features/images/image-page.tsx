import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import type { Session, SessionSummary } from "@alwith/module-chat/client"
import type { PromptInputMessage } from "@alwith/module-chat/composer"
import type { Attachment } from "@alwith/module-chat/composer-context"
import type { ImageArtifact } from "@alwith/module-chat/image"
import { PackageIcon, PaletteIcon, UserRoundIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import type { ImageRequestAspect } from "@/agent/image-request"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { ChatHostProvider } from "@/features/chat/chat-host"
import { ImageLightbox, openImageGallery } from "@/features/chat/dialogs/image-lightbox"
import { client, useSession } from "@/lib/client"

import { useImageAvailability } from "./availability"
import { submitImageEdit } from "./edit-session"
import { ImageComposer } from "./image-composer"
import { ImageGallery } from "./image-gallery"
import { ImageIcon } from "./image-icon"
import { imageAttachmentContent } from "./image-request"
import { ImageServiceNotice } from "./service-notice"

const templates = [
  { id: "portrait", icon: UserRoundIcon, reference: true },
  { id: "product", icon: PackageIcon, reference: false },
  { id: "illustration", icon: PaletteIcon, reference: false },
  { id: "poster", icon: ImageIcon, reference: false }
] as const
type ImageTemplate = (typeof templates)[number]

async function discardImageDraft(id: string) {
  if (client.state.drafts[id]) await client.discardDraft(id)
}

/** Discovery stays outside the conversation; accepted requests enter the existing chat surface. */
export function ImagePage({
  cwd,
  contextSession,
  contextSessionId,
  busy,
  onCreated,
  onOpenConversation
}: {
  cwd: string | null
  contextSession?: Session | null
  contextSessionId?: string
  busy: boolean
  onCreated: (id: string) => void
  onOpenConversation: (session: SessionSummary) => void
}) {
  const { t } = useTranslation()
  const availability = useImageAvailability()
  const [prompt, setPrompt] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [aspect, setAspect] = useState<ImageRequestAspect>("auto")
  const [template, setTemplate] = useState<ImageTemplate | null>(null)
  const [preview, setPreview] = useState<SessionSummary | null>(null)
  const [sending, setSending] = useState(false)
  const [preparing, setPreparing] = useState(true)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const draft = useSession(draftId)
  const preparation = useRef<Promise<string> | null>(null)
  const sourceSession = useRef(contextSession?.id)
  sourceSession.current = contextSession?.id
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const retrySession = useRef<{ id: string; cwd: string | null; request: Promise<string> } | null>(null)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!availability.available) {
      preparation.current = null
      setPreparing(false)
      setDraftId(null)
      return
    }
    let active = true
    const from = sourceSession.current
    setPreparing(true)
    setDraftId(null)
    setError(null)
    const request = client.connect().then(() =>
      client.newImageSession(cwd ?? undefined, {
        draft: true,
        ...(from ? { from } : {})
      })
    )
    preparation.current = request
    void request
      .then(
        (id) => {
          if (active) setDraftId(id)
        },
        (cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        }
      )
      .finally(() => {
        if (active) setPreparing(false)
      })
    return () => {
      active = false
      void request
        .then(
          async (id) => {
            if (pending.current) return
            await discardImageDraft(id)
            const retry = retrySession.current
            if (retry?.request === request && retry.id !== id) await discardImageDraft(retry.id)
          },
          () => undefined
        )
        .catch((cause: unknown) => toast.error(String(cause)))
    }
  }, [cwd, contextSessionId, attempt, availability.available])
  const reportError = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
  const startConversation = async (
    content: acp.ContentBlock[],
    directory: string | null,
    ratio?: ImageRequestAspect
  ) => {
    if (!availability.canGenerate) throw new Error(t("images.connectServices"))
    if (pending.current || busy) throw new Error(t("images.requestBusy"))
    const request = preparation.current
    if (!request) throw new Error("Image session preparation is missing")
    const isCurrent = () => mounted.current && preparation.current === request
    let prepared: string | undefined
    let submitted: string | undefined
    let accepted = false
    pending.current = true
    setSending(true)
    setError(null)
    try {
      prepared = await request
      if (!isCurrent()) throw new Error("The image request changed before sending")
      const retry = retrySession.current
      let id = retry?.request === request && retry.cwd === directory ? retry.id : undefined
      if (!id || !client.state.sessions[id]?.attached || client.state.sessions[id]?.readOnly) {
        id =
          directory === null || client.state.sessions[prepared]?.cwd === directory
            ? prepared
            : await client.newImageSession(directory, { draft: true, from: prepared })
        retrySession.current = { id, cwd: directory, request }
        if (retry?.request === request && retry.id !== prepared && retry.id !== id)
          void discardImageDraft(retry.id).catch((cause: unknown) => toast.error(String(cause)))
      }
      submitted = id
      if (!isCurrent()) throw new Error("The image request changed before sending")
      await client.promptWithImages(id, content, ratio ? { meta: { alwith: { imageAspectRatio: ratio } } } : {})
      accepted = true
      retrySession.current = null
      if (isCurrent()) {
        await client.discardDraft("main")
        if (!isCurrent()) return
        await client.open(id, client.state.sessions[id].cwd)
        if (isCurrent()) onCreated(id)
      }
    } catch (cause) {
      if (isCurrent()) throw cause
    } finally {
      pending.current = false
      if (mounted.current) setSending(false)
      const unused = new Set<string>()
      if (prepared && (!isCurrent() || (accepted && submitted && submitted !== prepared))) unused.add(prepared)
      if (submitted && !isCurrent()) unused.add(submitted)
      for (const id of unused) {
        void discardImageDraft(id).catch((cause: unknown) => toast.error(String(cause)))
      }
    }
  }
  const submit = async ({ text, files }: PromptInputMessage, ratio: ImageRequestAspect) => {
    if (!text.trim()) throw new Error(t("images.prompt"))
    const description = ratio === "auto" ? text.trim() : `${text.trim()}\n\n${t("images.aspectInstruction", { ratio })}`
    await startConversation(
      [{ type: "text", text: description }, ...(await Promise.all(files.map(imageAttachmentContent)))],
      cwd,
      ratio
    )
  }
  const selectTemplate = (value: ImageTemplate) => {
    setError(null)
    setTemplate(value)
  }
  const tryTemplate = async (value: ImageTemplate) => {
    try {
      if (!availability.available) {
        setPrompt(t(`images.templates.${value.id}.prompt`))
        setTemplate(null)
        setError(null)
        return
      }
      if (value.reference && !attachments.length) throw new Error(t("images.referenceRequired"))
      await submit({ text: t(`images.templates.${value.id}.prompt`), files: attachments }, aspect)
      if (mounted.current) setTemplate(null)
    } catch (cause: unknown) {
      reportError(cause)
    }
  }
  const previewImages = (row: SessionSummary, images: ImageArtifact[], index: number) => {
    setPreview(row)
    openImageGallery(
      images.map((image) => ({ src: image.src, alt: image.prompt ?? row.title ?? t("images.result") })),
      index,
      row.sessionId,
      "gallery"
    )
  }
  const ready =
    availability.canGenerate &&
    !busy &&
    !sending &&
    !preparing &&
    Boolean(draft?.attached && !draft.restoring && !draft.readOnly && draft.state === "idle")
  return (
    <ChatHostProvider>
      <ImageGallery
        busy={busy || sending}
        contextSessionId={contextSessionId}
        onPreview={previewImages}
        intro={
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-medium">{t("images.discover")}</h2>
              <p className="text-sm text-muted-foreground">{t("images.discoveryDescription")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              {templates.map((value) => (
                <Button
                  key={value.id}
                  variant="outline"
                  disabled={busy || sending}
                  className="h-auto min-h-32 flex-col items-start gap-3 rounded-xl p-4 text-start whitespace-normal"
                  onClick={() => selectTemplate(value)}
                >
                  <value.icon className="size-6 text-muted-foreground" />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">{t(`images.templates.${value.id}.title`)}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t(`images.templates.${value.id}.description`)}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </div>
        }
        footer={
          <div>
            {error && !template && availability.available && (
              <div
                role="alert"
                className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 px-6 text-sm text-destructive"
              >
                <span>{error}</span>
                {!draft && (
                  <Button variant="ghost" size="sm" onClick={() => setAttempt((value) => value + 1)}>
                    {t("images.retry")}
                  </Button>
                )}
              </div>
            )}
            <ImageServiceNotice availability={availability} />
            <ImageComposer
              text={prompt}
              onTextChange={setPrompt}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              aspectRatio={aspect}
              onAspectRatioChange={setAspect}
              ready={ready}
              sending={sending}
              onSubmit={(message) => submit(message, aspect)}
              onError={reportError}
            />
          </div>
        }
      />
      <Dialog
        open={template !== null}
        onOpenChange={(open) => {
          if (!open && !sending) {
            setTemplate(null)
            setError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl" showCloseButton={!sending}>
          <DialogHeader>
            <DialogTitle>{template ? t(`images.templates.${template.id}.title`) : t("images.discover")}</DialogTitle>
            <DialogDescription>
              {t(template?.reference ? "images.templateReferenceHint" : "images.templateHint")}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {template && (
            <>
              <p className="text-sm leading-6 text-muted-foreground">{t(`images.templates.${template.id}.prompt`)}</p>
              <DialogFooter>
                <Button
                  type="button"
                  disabled={busy || sending || (availability.available && !ready)}
                  onClick={() => void tryTemplate(template)}
                >
                  {sending && <Spinner data-icon="inline-start" />}
                  {t("images.tryTemplate")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ImageLightbox
        scope="gallery"
        sessionId={preview?.sessionId}
        onOpenConversation={() => {
          if (!preview) throw new Error("Image preview has no source conversation")
          onOpenConversation(preview)
        }}
        onSend={async (content) => {
          if (!preview) throw new Error("Image edit has no source conversation")
          if (!availability.canGenerate) throw new Error(t("images.connectServices"))
          if (pending.current || busy || sending) throw new Error(t("images.requestBusy"))
          setSending(true)
          try {
            const target = await submitImageEdit(client, preview, content, t("chat.image.edit.notReady"))
            onOpenConversation(target)
          } finally {
            if (mounted.current) setSending(false)
          }
        }}
      />
    </ChatHostProvider>
  )
}
