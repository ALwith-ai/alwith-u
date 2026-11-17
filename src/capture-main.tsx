import { CapturePreview } from "@alwith/module-device/preview"
import { deviceBridge } from "@alwith/module-device/tauri"
import { createRoot } from "react-dom/client"

import { ErrorBoundary } from "@/components/error-boundary"
import "./index.css"

const query = new URLSearchParams(location.search)
const session = query.get("session")
const capture = query.get("capture")
if (!session || !capture) throw new Error("Capture window requires an explicit session and capture")
document.documentElement.classList.toggle("dark", query.get("theme") === "dark")
const language = query.get("language") ?? "en"
document.documentElement.lang = language
const root = document.getElementById("root")
if (!root) throw new Error("Capture page has no root")
createRoot(root).render(
  <ErrorBoundary>
    <CapturePreview bridge={deviceBridge(session)} captureId={capture} language={language} />
  </ErrorBoundary>
)
