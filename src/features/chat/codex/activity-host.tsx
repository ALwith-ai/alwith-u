import type { ActivityHost } from "@alwith/module-chat/activity-host"
import { TerminalOutput } from "@alwith/module-chat/terminal-output"
import { invoke } from "@tauri-apps/api/core"
import { useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"

import { openImageGallery, openImageLightbox } from "../dialogs/image-lightbox"
import { ChatDirectoryContext, ChatOpenSessionContext, useOpenChatLink } from "../file-actions"
import { CodexMarkdownRenderer } from "./markdown-renderer"
import { PatchView } from "./patch-view"

// Adapter image paths are filesystem paths, so preserve literal percent signs and hashes.
function imageFilePath(path: string, cwd: string | null): string {
  if (path.startsWith("file:")) {
    const url = new URL(path)
    let value = decodeURIComponent(url.pathname)
    if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1)
    if (url.hostname && url.hostname !== "localhost") value = `//${url.hostname}${value}`
    return value
  }
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith(String.raw`\\`)) return path
  if (cwd === null) throw new Error("Image view directory is unavailable")
  return `${cwd.replace(/[\\/]$/, "")}/${path}`
}

export function useChatActivityHost(sessionId?: string): ActivityHost {
  const openLink = useOpenChatLink()
  const cwd = useContext(ChatDirectoryContext)
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
        openImage: (src) => openImageLightbox(src, "", undefined, sessionId),
        openImageGallery: (images, index) => openImageGallery(images, index, sessionId),
        loadImage: async (path) => {
          const preview = await invoke<
            { kind: "image"; data: string; mimeType: string } | { kind: "text"; text: string } | { kind: "unsupported" }
          >("chat_preview_file", { path: imageFilePath(path, cwd) })
          if (preview.kind !== "image") throw new Error("Image preview is unavailable")
          return `data:${preview.mimeType};base64,${preview.data}`
        },
        ...(openSession === null ? {} : { openSession }),
        expandToolOutput: true,
        commandStatus: (block) => {
          if (block.status === "pending" || block.status === "in_progress") return undefined
          if (block.status === "cancelled" || block.status === "interrupted") return t("chat.tool.stopped")
          if (block.exitCode !== undefined && block.exitCode !== 0)
            return t("chat.tool.exitCode", { code: block.exitCode })
          return t(block.status === "failed" ? "chat.tool.failed" : "chat.tool.success")
        }
      }) satisfies ActivityHost,
    [i18n, language, t, openLink, openSession, cwd, sessionId]
  )
}
