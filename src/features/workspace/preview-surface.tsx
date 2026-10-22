import { Allotment, LayoutPriority } from "allotment"
import { FolderTree, Maximize2, Minimize2, X } from "lucide-react"
import { type ReactNode, useContext } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import "allotment/dist/style.css"
import { PanelControlsContext } from "./panel-controls-context"

// Desktop's PreviewSurface preserves the tree's pixel width and gives the editor spare space.
export function PreviewSurface({
  tree,
  editor,
  treeVisible,
  onTreeVisibleChange,
  maximized,
  onMaximize,
  onClose
}: {
  tree: ReactNode
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
  return (
    <Allotment
      proportionalLayout={false}
      onVisibleChange={(index, visible) => {
        if (index === 1) onTreeVisibleChange(visible)
      }}
    >
      <Allotment.Pane minSize={240} priority={LayoutPriority.High}>
        <div className="file-workspace-editor" data-tree-hidden={!treeVisible}>
          {editor({
            leading: !treeVisible && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={false}
                aria-label={t("workspace.showTree")}
                title={t("workspace.showTree")}
                onClick={() => onTreeVisibleChange(true)}
              >
                <FolderTree />
              </Button>
            ),
            trailing: (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={expanded}
                  aria-label={t(expanded ? "workspace.exitViewMode" : "workspace.enterViewMode")}
                  title={t(expanded ? "workspace.exitViewMode" : "workspace.enterViewMode")}
                  onClick={controls?.toggleExpanded ?? onMaximize}
                >
                  {expanded ? <Minimize2 /> : <Maximize2 />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("workspace.closePreview")}
                  title={t("workspace.closePreview")}
                  onClick={onClose}
                >
                  <X />
                </Button>
              </>
            )
          })}
        </div>
      </Allotment.Pane>
      <Allotment.Pane minSize={170} preferredSize={240} snap visible={treeVisible}>
        <div
          className="file-workspace-tree"
          data-collapsed={!treeVisible}
          inert={!treeVisible}
          aria-hidden={!treeVisible}
        >
          {tree}
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}
