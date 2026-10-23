import {
  type EditorShortcutRenderer,
  EditorWorkbench,
  type EditorWorkbenchProps,
  type EditorWorkspaceController,
  NewTabPage,
  WorkspaceTabs
} from "@alwith/module-editor"
import { FileVisualIcon, getFileVisual, useFileIconTheme } from "@alwith/module-file-tree"
import { FileText } from "lucide-react"
import { cloneElement, type ReactNode, useSyncExternalStore } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/alwith-ui/button"
import { ShortcutKey } from "@/components/alwith-ui/shortcut-hint"
import { openGuideWindow } from "@/features/guide/guide-window"
import { openSettingsWindow } from "@/lib/window-manager"

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
  ...props
}: EditorWorkbenchProps & {
  tabs: EditorWorkspaceController
  leading: ReactNode
  trailing: ReactNode
  iconTheme: IconTheme
  isDark: boolean
}): ReactNode {
  const { t } = useTranslation()
  const snapshot = useSyncExternalStore(tabs.subscribe, tabs.getSnapshot)
  const selected = snapshot.tabs.find((tab) => tab.id === snapshot.activeId)
  const readyTheme = useFileIconTheme(iconTheme, props.onError)
  return (
    <EditorWorkbench
      {...props}
      renderShortcutHint={renderShortcutHint}
      tabBar={(prefix) => (
        <WorkspaceTabs
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
        selected?.kind === "file"
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
