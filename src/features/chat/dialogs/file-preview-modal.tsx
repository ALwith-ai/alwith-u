import { invoke } from "@tauri-apps/api/core"
import { openPath, revealItemsInDir } from "@tauri-apps/plugin-opener"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { create } from "zustand"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { FilePosition } from "@/features/workspace/context"

type Request = { path: string; position?: FilePosition }
type Preview =
  { kind: "text"; text: string } | { kind: "image"; data: string; mimeType: string } | { kind: "unsupported" }
const useFilePreview = create<{ request: Request | null }>(() => ({ request: null }))

export function openFilePreview(path: string, position?: FilePosition): void {
  useFilePreview.setState({ request: { path, position } })
}

function PreviewContent({ request }: { request: Request }) {
  const { t } = useTranslation()
  const [result, setResult] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const line = useRef<HTMLElement>(null)
  useEffect(() => {
    let active = true
    void invoke<Preview>("chat_preview_file", { path: request.path }).then(
      value => {
        if (active) setResult(value)
      },
      (error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : String(error))
      }
    )
    return () => {
      active = false
    }
  }, [request.path])
  useEffect(() => {
    if (result?.kind === "text") line.current?.scrollIntoView({ block: "center" })
  }, [result])
  if (error !== null)
    return (
      <div role="alert" className="p-4 text-sm text-destructive">
        {error}
      </div>
    )
  if (result === null)
    return (
      <div role="status" className="p-4 text-sm text-muted-foreground">
        {t("workspace.loading")}
      </div>
    )
  if (result.kind === "unsupported")
    return <p className="p-4 text-sm text-muted-foreground">{t("chat.filePreview.unsupported")}</p>
  if (result.kind === "image")
    return (
      <img
        className="mx-auto max-w-full"
        alt={request.path.split(/[\\/]/).at(-1)}
        src={`data:${result.mimeType};base64,${result.data}`}
      />
    )
  const lines = result.text.split("\n")
  const index = Math.min(lines.length - 1, Math.max(0, (request.position?.lineNumber ?? 1) - 1))
  return (
    <pre className="min-w-max p-4 font-mono text-sm leading-6">
      {request.position === undefined ? (
        result.text
      ) : (
        <>
          {lines.slice(0, index).join("\n")}
          {index > 0 && "\n"}
          <mark ref={line} className="bg-accent text-accent-foreground">
            {lines[index] || " "}
          </mark>
          {index < lines.length - 1 && "\n"}
          {lines.slice(index + 1).join("\n")}
        </>
      )}
    </pre>
  )
}

export function FilePreviewModal() {
  const { t } = useTranslation()
  const request = useFilePreview(state => state.request)
  const run = (action: () => Promise<void>) => {
    void action().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
  }
  return (
    <Dialog open={request !== null} onOpenChange={open => !open && useFilePreview.setState({ request: null })}>
      <DialogContent className="flex h-[calc(100vh-2.5rem)] max-h-[900px] flex-col gap-3 sm:max-w-[min(1400px,calc(100vw-2.5rem))]">
        <DialogHeader>
          <DialogTitle className="truncate pe-8 font-mono text-sm font-normal" title={request?.path}>
            {request?.path.split(/[\\/]/).at(-1)}
          </DialogTitle>
          <DialogDescription className="break-all">
            {t("chat.filePreview.readOnly")} · {request?.path}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => request && run(() => revealItemsInDir(request.path))}>
            {t("chat.filePreview.reveal")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => request && run(() => openPath(request.path))}>
            {t("chat.filePreview.openExternal")}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          {request && (
            <PreviewContent key={`${request.path}:${request.position?.lineNumber ?? ""}`} request={request} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
