import { useCallback, useState } from "react"
/** Isolated native test entry: the actual browser pane, without auth or an agent runtime. */
import { createRoot } from "react-dom/client"

import { initI18n } from "@/lib/i18n"

import { BrowserWorkspace } from "./browser-workspace"
import { usePreviewRequest } from "./preview-request"
import "@/index.css"
function Fixture() {
  const [active, setActive] = useState(true)
  const show = useCallback(() => setActive(true), [])
  const request = usePreviewRequest(true, show)
  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="p-2">Isolated native test · Browser workspace</header>
      <BrowserWorkspace
        active={active}
        maximized={false}
        onMaximize={() => {}}
        onClose={() => setActive(false)}
        request={request}
      />
    </main>
  )
}
// The contract scripts ask for controls by their Chinese names.
await initI18n("zh-CN")
createRoot(document.getElementById("root")!).render(<Fixture />)
