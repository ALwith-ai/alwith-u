import type { ContentBlock } from "@agentclientprotocol/sdk/experimental/v2"
import { isEmbeddedResource, isImage, isResourceLink } from "@alwith/api"
import { DownloadIcon, FileIcon } from "lucide-react"
import { useState, type ReactElement } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { chatFileName, downloadChatFile, useOpenChatLink } from "../file-actions"
import { openImageLightbox } from "../dialogs/image-lightbox"

export function ResourceContent({ block }: { block: ContentBlock }): ReactElement | null {
  const { t } = useTranslation()
  const openLink = useOpenChatLink()
  const [saving, setSaving] = useState(false)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  if (isResourceLink(block)) {
    const name = chatFileName(block.uri)
    return (
      <Button
        variant="outline"
        className="h-auto max-w-full justify-start gap-3 p-3"
        aria-label={block.title ?? block.name}
        title={block.uri}
        onClick={() => openLink(block.uri)}>
        <FileIcon />
        <span className="min-w-0 text-start">
          <span className="block truncate">{block.title ?? block.name}</span>
          <span className="text-muted-foreground block text-xs">
            {name} · {block.mimeType ?? name.split(".").at(-1)?.toUpperCase()}
          </span>
        </span>
      </Button>
    )
  }
  if (!isEmbeddedResource(block) && !isImage(block)) return null
  const resource = isImage(block)
    ? { uri: block.uri ?? `image.${block.mimeType.split("/")[1] ?? "png"}`, mimeType: block.mimeType, blob: block.data }
    : block.resource
  const name = chatFileName(resource.uri)
  if ("text" in resource)
    return (
      <div className="min-w-0">
        <pre className="overflow-x-auto whitespace-pre-wrap">{resource.text}</pre>
        <Button variant="link" size="sm" title={resource.uri} onClick={() => openLink(resource.uri)}>
          <FileIcon />
          {name}
        </Button>
      </div>
    )
  const src = `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`
  const image = resource.mimeType?.toLowerCase().startsWith("image/") && failedImage !== src
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await downloadChatFile(resource.uri, resource.blob)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {image && (
        <Button
          variant="ghost"
          className="h-auto p-0"
          aria-label={t("chat.image.view")}
          onClick={() => openImageLightbox(src)}>
          <img
            src={src}
            alt=""
            className="max-h-96 max-w-full rounded object-contain"
            onError={() => setFailedImage(src)}
          />
        </Button>
      )}
      <Button
        variant="link"
        size="sm"
        disabled={saving}
        title={resource.uri}
        aria-label={t("chat.content.download", { name })}
        onClick={() => {
          void save()
        }}>
        <DownloadIcon />
        {name}
      </Button>
    </div>
  )
}
