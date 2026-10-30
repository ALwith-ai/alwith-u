import { CodexMarkdownRenderer } from "@alwith/module-chat/markdown"
import { dirname, normalizePath } from "@alwith/module-fs"
import { createTauriAdapter } from "@alwith/module-fs/tauri"
import { invoke } from "@tauri-apps/api/core"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { openPath, revealItemsInDir } from "@tauri-apps/plugin-opener"
import { MoreHorizontalIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Pane } from "@/components/alwith-ui/pane"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { openExternal } from "@/lib/open"

import "./skill-document.css"

export async function readSkillDocument(path: string): Promise<string> {
  const root = await invoke<string>("workspace_open", { path: dirname(path) })
  const fs = createTauriAdapter({
    root,
    transport: { invoke: (request) => invoke("workspace_file", { request }) }
  })
  return new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(path))
}

/** Hide metadata already represented by the catalog, preserving the original document for copying. */
export function skillMarkdownBody(text: string): string {
  return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "")
}

export function SkillDocument({
  path,
  renderHeader,
  description
}: {
  path: string | null
  description?: string
  renderHeader?: (actions: ReactNode) => ReactNode
}) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [document, setDocument] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setDocument(null)
    setError(null)
    void (path === null ? Promise.resolve(description ?? "") : readSkillDocument(path)).then(
      (value) => {
        if (!cancelled) setDocument(value)
      },
      (reason: unknown) => {
        if (!cancelled) setError(String(reason))
      }
    )
    return () => {
      cancelled = true
    }
  }, [path, description, attempt])
  const report = (action: Promise<unknown>) => void action.catch((reason: unknown) => toast.error(String(reason)))
  const actions =
    path === null ? null : (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={t("plugins.card.moreActions")} />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => report(openPath(path))}>
            {t("plugins.skills.document.open")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => report(revealItemsInDir(path))}>
            {t("plugins.skills.document.reveal")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={document === null}
            onClick={() => {
              if (document !== null) report(writeText(document))
            }}
          >
            {t("plugins.skills.document.copy")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  return (
    <>
      {renderHeader ? renderHeader(actions) : <div className="flex justify-end">{actions}</div>}
      <Pane
        className="skill-document h-[45dvh] min-h-32 min-w-0 flex-none rounded-xl bg-muted/50 pe-0"
        viewportClassName="overscroll-contain p-5 text-sm leading-6"
        viewportProps={{ role: "region", tabIndex: 0, "aria-label": t("plugins.skills.document.content") }}
      >
        {error ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm break-words text-destructive">
              {t("plugins.skills.document.error")}: {error}
            </p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              {t("plugins.loadError.retry")}
            </Button>
          </div>
        ) : document === null ? (
          <div role="status" aria-label={t("plugins.skills.loading")} className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <CodexMarkdownRenderer
            text={skillMarkdownBody(document)}
            host={{
              theme: resolvedTheme,
              copyLabel: t("actions.copy"),
              openLink: (href) =>
                report(
                  openExternal(
                    /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href) || path === null
                      ? href
                      : normalizePath(`${dirname(path)}/${href}`)
                  )
                )
            }}
          />
        )}
      </Pane>
    </>
  )
}
