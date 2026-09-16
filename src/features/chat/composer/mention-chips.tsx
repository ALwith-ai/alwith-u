/**
 * The files the next message will reference, above the input (ALwith Desktop's
 * MentionChips without the active-editor-tab and image-size parts): one chip per
 * `@`-mention, each removable.
 */
import { FileIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { basename } from "@/lib/path"

export function MentionChips({ mentions, onRemove }: { mentions: string[]; onRemove: (path: string) => void }) {
  const { t } = useTranslation()
  if (mentions.length === 0) return null
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      {mentions.map(path => (
        <Badge key={path} variant="secondary" className="gap-1 pe-0.5" title={path}>
          <FileIcon className="size-3" />
          <span className="max-w-40 truncate">{basename(path)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-4"
            aria-label={t("chat.mention.remove", { name: basename(path) })}
            onClick={() => onRemove(path)}>
            <XIcon className="size-3" />
          </Button>
        </Badge>
      ))}
    </div>
  )
}
