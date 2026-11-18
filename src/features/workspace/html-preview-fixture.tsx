import { useState } from "react"

import { WorkspaceHeaderContext } from "./context"
import { FileWorkspace } from "./file-workspace"

export function HtmlPreviewFixture({ directory }: { directory: string }) {
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <WorkspaceHeaderContext.Provider value={toolbar}>
        <div ref={setToolbar} />
        <FileWorkspace cwd={directory}>{null}</FileWorkspace>
      </WorkspaceHeaderContext.Provider>
    </main>
  )
}
