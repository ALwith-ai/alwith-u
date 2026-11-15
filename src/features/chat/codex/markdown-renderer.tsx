import { type MarkdownHost, CodexMarkdownRenderer as SharedMarkdown } from "@alwith/module-chat/markdown"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { copyText } from "@/lib/clipboard"

import { useOpenChatLink } from "../file-actions"

export function CodexMarkdownRenderer({ text, streaming }: { text: string; streaming?: boolean }) {
  const openLink = useOpenChatLink()
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const copyLabel = t("actions.copy")
  const host = useMemo<MarkdownHost>(
    () => ({
      theme: resolvedTheme,
      copyLabel,
      openLink,
      copyText,
      onCopyError: (error) => toast.error(error instanceof Error ? error.message : String(error))
    }),
    [resolvedTheme, copyLabel, openLink]
  )
  // Code blocks need a full-width containing box inside the assistant's start-aligned flex layout.
  return (
    <div className="w-full min-w-0">
      <SharedMarkdown text={text} streaming={streaming} host={host} />
    </div>
  )
}
