import { invoke } from "@tauri-apps/api/core"

import { openExternal } from "@/lib/open"
import { runtimeCapabilities } from "@/lib/runtime-capabilities"

/** Browser readiness is independent of terminal and HTTP server readiness. */
export async function openTerminalLink(sessionId: string, url: string): Promise<void> {
  if ((await runtimeCapabilities()).embeddedBrowser) await invoke("cef_browser_open_url", { sessionId, url })
  else await openExternal(url)
}
