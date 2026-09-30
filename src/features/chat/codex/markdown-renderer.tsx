import { type MarkdownHost, CodexMarkdownRenderer as SharedMarkdown } from "@alwith/module-chat/markdown"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/theme-provider"
import { openExternal } from "@/lib/open"

const openLink = (url: string): void => { void openExternal(url) }

export function CodexMarkdownRenderer({ text, streaming }: { text: string; streaming?: boolean }) {
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const copyLabel = t("actions.copy")
  const host = useMemo<MarkdownHost>(() => ({ theme: resolvedTheme, copyLabel, openLink }), [resolvedTheme, copyLabel])
  return <SharedMarkdown text={text} streaming={streaming} host={host} />
}
