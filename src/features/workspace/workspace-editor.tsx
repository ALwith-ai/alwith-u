import {
  type EditorShortcutRenderer,
  EditorWorkbench,
  type EditorWorkbenchProps,
  NewTabPage
} from "@alwith/module-editor"
import type { FileTabsController } from "@alwith/module-editor/tabs/core"
import { FileVisualIcon, getFileVisual, useFileIconTheme } from "@alwith/module-file-tree"
import type { FileStat } from "@alwith/module-fs"
import { FileText } from "lucide-react"
import { cloneElement, type ReactNode, useEffect, useState, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/alwith-ui/button"
import { ShortcutKey } from "@/components/alwith-ui/shortcut-hint"
import { openGuideWindow } from "@/features/guide/guide-window"
import { openSettingsWindow } from "@/lib/window-manager"

import { FileTabs } from "./file-tabs"
import type { IconTheme } from "./workspace-state"

const EDITOR_SHORTCUTS = { save: "CmdOrCtrl+S" } as const
const renderShortcutHint: EditorShortcutRenderer = (action, label, trigger) =>
  cloneElement(
    trigger,
    { title: undefined },
    <span className="inline-flex w-full items-center gap-4">
      <span>{label}</span>
      <ShortcutKey shortcut={EDITOR_SHORTCUTS[action]} className="ml-auto shrink-0" />
    </span>
  )

export function WorkspaceEditor({
  tabs,
  leading,
  trailing,
  iconTheme,
  isDark,
  statFile,
  ...props
}: EditorWorkbenchProps & {
  tabs: FileTabsController
  leading: ReactNode
  trailing: ReactNode
  iconTheme: IconTheme
  isDark: boolean
  statFile?: (path: string) => Promise<FileStat | null>
}): ReactNode {
  const { t } = useTranslation()
  const snapshot = useSyncExternalStore(tabs.subscribe, tabs.getSnapshot)
  const selected = snapshot.tabs.find((tab) => tab.id === snapshot.activeId)
  const document = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot).documents.find(
    (entry) => entry.id === selected?.id
  )
  const summary =
    document &&
    (document.status === "tooLarge" ||
      (document.status === "loaded" &&
        document.kind === "binary" &&
        !props.previews?.some((preview) => preview.supports(document))))
  const readyTheme = useFileIconTheme(iconTheme, props.onError)
  return (
    <EditorWorkbench
      {...props}
      showToolbarActions={false}
      renderShortcutHint={renderShortcutHint}
      tabBar={(prefix) => (
        <FileTabs
          workspace={tabs}
          editor={props.controller}
          prefix={prefix}
          leading={leading}
          trailing={trailing}
          labels={{
            newTab: t("workspace.newTab"),
            close: t("workspace.close"),
            closeOthers: t("workspace.closeOthers"),
            closeRight: t("workspace.closeRight"),
            closeSaved: t("workspace.closeSaved"),
            closeAll: t("workspace.closeAll"),
            copyPath: t("workspace.copyPath"),
            reveal: t("workspace.reveal")
          }}
          newTabIcon={<FileText />}
          renderFileIcon={(document) => <FileVisualIcon icon={getFileVisual(document.path, isDark, readyTheme)} />}
          onCopyPath={props.onCopyPath}
          onReveal={props.onReveal}
          onError={props.onError}
        />
      )}
      contentOverride={
        summary && document && statFile
          ? () => (
              <FileSummary
                path={document.path}
                statFile={statFile}
                message={t(document.status === "tooLarge" ? "workspace.previewTooLarge" : "workspace.unsupported")}
                openLabel={t("workspace.openExternal")}
                onLoad={document.status === "tooLarge" ? () => props.controller.openAnyway(document.id) : undefined}
                onOpen={() => props.onOpenExternal?.(document)}
                onError={props.onError}
              />
            )
          : selected?.kind === "file"
            ? undefined
            : (prefix) =>
                selected ? (
                  <div
                    className="workspace-new-tab-panel"
                    role="tabpanel"
                    id={`${prefix}-panel-${selected.id}`}
                    aria-labelledby={`${prefix}-tab-${selected.id}`}
                  >
                    <NewTabPage
                      title={t("workspace.tutorialTitle")}
                      link={t("workspace.tutorialLink")}
                      onTutorial={() => {
                        void openGuideWindow().catch(props.onError)
                      }}
                    />
                  </div>
                ) : (
                  <div className="workspace-empty-editor">
                    <div className="workspace-empty-actions">
                      <Button variant="ghost" onClick={() => tabs.openNewTab()}>
                        <span>{t("workspace.emptyNewTab")}</span>
                        <ShortcutKey shortcut="CmdOrCtrl+T" className="ml-auto shrink-0" />
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void openSettingsWindow().catch(props.onError)
                        }}
                      >
                        <span>{t("workspace.emptyOpenSettings")}</span>
                        <ShortcutKey shortcut="CmdOrCtrl+," className="ml-auto shrink-0" />
                      </Button>
                    </div>
                  </div>
                )
      }
    />
  )
}

function FileSummary({
  path,
  statFile,
  message,
  openLabel,
  onLoad,
  onOpen,
  onError
}: {
  path: string
  statFile: (path: string) => Promise<FileStat | null>
  message?: string
  openLabel: string
  onLoad?: () => Promise<void>
  onOpen: () => void | Promise<void>
  onError: (error: unknown) => void
}) {
  const { i18n, t } = useTranslation()
  const [file, setFile] = useState<{ path: string; size: number } | null>(null)
  useEffect(() => {
    let active = true
    void statFile(path).then(
      (stat) => {
        if (active && stat?.kind === "file") setFile({ path, size: stat.size })
      },
      (error: unknown) => {
        if (active) onError(error)
      }
    )
    return () => {
      active = false
    }
  }, [path, statFile, onError])
  return (
    <div className="alwith-editor-empty gap-2" role="status">
      <p>{message}</p>
      <p className="max-w-full break-all text-muted-foreground">{path}</p>
      {file?.path === path && (
        <p className="text-muted-foreground">
          {new Intl.NumberFormat(i18n.resolvedLanguage, { style: "unit", unit: "byte" }).format(file.size)}
        </p>
      )}
      <div className="flex gap-2">
        {onLoad && (
          <Button variant="outline" onClick={() => void onLoad().catch(onError)}>
            {t("workspace.openAnyway")}
          </Button>
        )}
        <Button variant="outline" onClick={() => void Promise.try(onOpen).catch(onError)}>
          {openLabel}
        </Button>
      </div>
    </div>
  )
}
