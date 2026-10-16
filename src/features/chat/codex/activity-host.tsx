import type { ActivityHost } from "@alwith/module-chat/activity-host"
import { TerminalOutput } from "@alwith/module-chat/terminal-output"
import { useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { openImageLightbox } from "../dialogs/image-lightbox"
import { ChatOpenSessionContext, useOpenChatLink } from "../file-actions"
import { CodexMarkdownRenderer } from "./markdown-renderer"
import { PatchView } from "./patch-view"

export function useChatActivityHost(): ActivityHost {
  const openLink = useOpenChatLink()
  const openSession = useContext(ChatOpenSessionContext)
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? "en"
  return useMemo(
    () =>
      ({
        t: (key, values) => i18n.t(key, { ...values, ns: "alwithChat" }),
        i18n: { language },
        openLink,
        Markdown: CodexMarkdownRenderer,
        Output: TerminalOutput,
        Patch: PatchView,
        openImage: openImageLightbox,
        ...(openSession === null ? {} : { openSession }),
        expandToolOutput: true,
        commandStatus: block => {
          if (block.status === "pending" || block.status === "in_progress") return undefined
          if (block.status === "cancelled" || block.status === "interrupted") return t("chat.tool.stopped")
          if (block.exitCode !== undefined && block.exitCode !== 0)
            return t("chat.tool.exitCode", { code: block.exitCode })
          return t(block.status === "failed" ? "chat.tool.failed" : "chat.tool.success")
        }
      }) satisfies ActivityHost,
    [i18n, language, t, openLink, openSession]
  )
}
