import type { ActivityHost } from "@alwith/module-chat/activity-host"
import { desktopLoadImage } from "@alwith/module-chat/desktop"
import { TerminalOutput } from "@alwith/module-chat/terminal-output"
import { useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { copyText } from "@/lib/clipboard"

import { openImageGallery, openImageLightbox } from "../dialogs/image-lightbox"
import { ChatOpenSessionContext, useOpenChatLink } from "../file-actions"
import { CodexMarkdownRenderer } from "./markdown-renderer"
import { PatchView } from "./patch-view"

export function useChatActivityHost(sessionId?: string): ActivityHost {
  const openLink = useOpenChatLink()
  const openSession = useContext(ChatOpenSessionContext)
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? "en"
  return useMemo(
    () =>
      ({
        t: (key, values) => i18n.t(key, { ...values, ns: "alwithChat" }),
        i18n: { language },
        openLink,
        copyText,
        onCopyError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
        Markdown: CodexMarkdownRenderer,
        Output: TerminalOutput,
        Patch: PatchView,
        openImage: (src) => openImageLightbox(src, "", undefined, sessionId),
        openImageGallery: (images, index) => openImageGallery(images, index, sessionId),
        loadImage: desktopLoadImage,
        ...(openSession === null ? {} : { openSession }),
        expandToolOutput: true
      }) satisfies ActivityHost,
    [i18n, language, openLink, openSession, sessionId]
  )
}
