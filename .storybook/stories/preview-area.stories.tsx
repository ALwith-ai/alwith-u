import { createEditorController, createEditorWorkspace } from "@alwith/module-editor"
import { createFileTreeController, FileTree } from "@alwith/module-file-tree"
import { createFileSystem } from "@alwith/module-fs"
import { createMemoryAdapter } from "@alwith/module-fs/testing"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { FolderTree } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { expect, waitFor } from "storybook/test"

import { useTheme } from "../../src/components/theme-provider"
import { Button } from "../../src/components/ui/button"
import { PreviewSurface } from "../../src/features/workspace/preview-surface"
import { createTreeOpener } from "../../src/features/workspace/tree-opener"
import { WorkspaceEditor } from "../../src/features/workspace/workspace-editor"
import "@alwith/module-file-tree/styles.css"
import "@alwith/module-editor/styles.css"
import "../../src/features/workspace/workspace.css"

function PreviewExample(): ReactNode {
  const { resolvedTheme } = useTheme()
  const [error, setError] = useState("")
  const [treeVisible, setTreeVisible] = useState(true)
  const [maximized, setMaximized] = useState(false)
  const [closed, setClosed] = useState(false)
  const [state] = useState(() => {
    const reportError = (error: unknown): void => {
      setError(String(error))
    }
    const fs = createFileSystem({
      adapter: createMemoryAdapter({
        "/ALwith/.alwith/project.json": "{}",
        "/ALwith/.alwith/settings.local.json": "{}",
        "/ALwith/docs/notes.md": "# Notes\n\nWelcome to ALwith.",
        "/ALwith/README.md": "# ALwith\n\nA shared workspace.",
        "/ALwith/package.json": '{\n  "name": "alwith"\n}',
        "/ALwith/summary.txt": "Summary"
      }),
      reportError
    })
    const editor = createEditorController({ fs, reportError, confirmClose: async () => "cancel" })
    const tabs = createEditorWorkspace(editor)
    const tree = createFileTreeController({
      fs,
      root: "/ALwith",
      expanded: ["/ALwith", "/ALwith/.alwith"],
      reportError
    })
    const opener = createTreeOpener(editor, async (path) => path, tabs)
    return { tree, editor, tabs, opener, reportError }
  })
  useEffect(() => {
    void state.tree
      .setShowHidden(true)
      .then(() => state.tree.refresh())
      .catch(state.reportError)
  }, [state])
  return (
    <div className="p-1">
      {error && <div role="alert">{error}</div>}
      {closed ? (
        <Button onClick={() => setClosed(false)}>Reopen preview</Button>
      ) : (
        <div className="file-workspace-panel" style={{ height: 730, width: maximized ? "100%" : 748 }}>
          <PreviewSurface
            treeVisible={treeVisible}
            onTreeVisibleChange={setTreeVisible}
            maximized={maximized}
            onMaximize={() => setMaximized((value) => !value)}
            onClose={() => setClosed(true)}
            tree={
              <FileTree
                requestName={async () => null}
                confirmDelete={async () => false}
                controller={state.tree}
                isDark={resolvedTheme === "dark"}
                onError={state.reportError}
                onOpenFile={(path) => state.opener.open(path)}
                onPinFile={(path) => state.opener.open(path, true)}
                explorerControl={
                  <Button variant="ghost" size="icon-sm" aria-label="Hide tree" onClick={() => setTreeVisible(false)}>
                    <FolderTree />
                  </Button>
                }
              />
            }
            editor={({ leading, trailing }) => (
              <WorkspaceEditor
                controller={state.editor}
                tabs={state.tabs}
                leading={leading}
                trailing={trailing}
                iconTheme="vscode-icons"
                isDark={resolvedTheme === "dark"}
                onError={state.reportError}
                rootPath="/ALwith"
                compactToolbar
              />
            )}
          />
        </div>
      )}
    </div>
  )
}
const meta = {
  title: "Workspace/Desktop parity",
  component: PreviewExample,
  parameters: { layout: "fullscreen" }
} satisfies Meta<typeof PreviewExample>
export default meta
type Story = StoryObj<typeof meta>
export const NewTab: Story = {}
export const TabInteractions: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("treeitem", { name: "summary.txt" }))
    await canvas.findByRole("tab", { name: "summary.txt" })
    await userEvent.click(canvas.getByRole("button", { name: "New tab" }))
    await userEvent.click(canvas.getByRole("treeitem", { name: "package.json" }))
    await canvas.findByRole("tab", { name: "package.json" })
    expect(canvas.getByRole("tab", { name: "summary.txt" })).toBeVisible()
    await userEvent.click(canvas.getByRole("tab", { name: "summary.txt" }))
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "summary.txt" })).toHaveValue("Summary"))
    await userEvent.click(canvas.getByRole("tab", { name: "package.json" }))
    await userEvent.keyboard("{Delete}")
    await waitFor(() => expect(canvas.queryByRole("tab", { name: "package.json" })).toBeNull())
    await userEvent.click(canvas.getByRole("button", { name: "Close preview" }))
    await userEvent.click(canvas.getByRole("button", { name: "Reopen preview" }))
    expect(canvas.getByRole("tab", { name: "summary.txt" })).toHaveAttribute("aria-selected", "true")
  }
}
