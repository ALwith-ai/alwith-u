import { TabActionButton as Button } from "@alwith/module-tabs/react"
import { Allotment, LayoutPriority } from "allotment"
import { FolderTree, Maximize2, Minimize2, X } from "lucide-react"
import { type ReactNode, useContext, useState } from "react"
import { useTranslation } from "react-i18next"
import "allotment/dist/style.css"
import { PanelControlsContext } from "./panel-controls-context"
import { WorkspaceTabHostContext } from "./workspace-tab-host-context"

// The tab header belongs to the editor column; the file tree spans the full height.
export function PreviewSurface({
  tree,
  editor,
  treeVisible,
  onTreeVisibleChange,
  maximized,
  onMaximize,
  onClose
}: {
  tree: ReactNode | ((toggle: ReactNode) => ReactNode)
  editor: (controls: { leading: ReactNode; trailing: ReactNode }) => ReactNode
  treeVisible: boolean
  onTreeVisibleChange: (visible: boolean) => void
  maximized: boolean
  onMaximize: () => void
  onClose: () => void
}): ReactNode {
  const { t } = useTranslation()
  const controls = useContext(PanelControlsContext)
  const expanded = controls?.expanded ?? maximized
  const [tabHost, setTabHost] = useState<HTMLDivElement | null>(null)
  const treeToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="alwith-tab-action"
      aria-expanded={treeVisible}
      aria-label={t(treeVisible ? "workspace.hideTree" : "workspace.showTree")}
      title={t(treeVisible ? "workspace.hideTree" : "workspace.showTree")}
      shortcut="CmdOrCtrl+Shift+E"
      tooltipSide="bottom"
      onClick={() => onTreeVisibleChange(!treeVisible)}
    >
      <FolderTree className="size-4" />
    </Button>
  )
  return (
    <WorkspaceTabHostContext.Provider value={tabHost}>
      <div className="workspace-preview-surface">
        <div className="workspace-preview-body">
          <Allotment
            proportionalLayout={false}
            onVisibleChange={(index, visible) => {
              if (index === 1) onTreeVisibleChange(visible)
            }}
          >
            <Allotment.Pane minSize={240} priority={LayoutPriority.High}>
              <div className="workspace-editor-column">
                <div className="workspace-tab-host alwith-editor" ref={setTabHost} />
                <div className="file-workspace-editor" data-tree-hidden={!treeVisible}>
                  {editor({
                    leading: null,
                    trailing: (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="alwith-tab-action"
                          aria-pressed={expanded}
                          aria-label={t(expanded ? "workspace.exitViewMode" : "workspace.enterViewMode")}
                          title={t(expanded ? "workspace.exitViewMode" : "workspace.enterViewMode")}
                          shortcut=""
                          tooltipSide="bottom"
                          onClick={controls?.toggleExpanded ?? onMaximize}
                        >
                          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="alwith-tab-action"
                          aria-label={t("workspace.closeWorkspace")}
                          title={t("workspace.closeWorkspace")}
                          shortcut=""
                          tooltipSide="bottom"
                          onClick={onClose}
                        >
                          <X className="size-4" />
                        </Button>
                        {!treeVisible && treeToggle}
                      </>
                    )
                  })}
                </div>
              </div>
            </Allotment.Pane>
            <Allotment.Pane minSize={170} preferredSize={240} snap visible={treeVisible}>
              <div
                className="file-workspace-tree"
                data-collapsed={!treeVisible}
                inert={!treeVisible}
                aria-hidden={!treeVisible}
              >
                {typeof tree === "function" ? tree(treeVisible ? treeToggle : null) : tree}
              </div>
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>
    </WorkspaceTabHostContext.Provider>
  )
}
