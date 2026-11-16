import { defineApplicationTool } from "@alwith/module-chat/client"
import { invoke } from "@tauri-apps/api/core"

import { tools } from "./definitions.mjs"

const readOnlyTools = new Set([
  "browser_list", "browser_read_page", "browser_read_elements", "browser_inspect", "browser_diagnostics", "browser_wait"
])

/** Model-independent application tools; the native host owns execution and session leases. */
export function createWebAutomationTools() {
  return tools.map((definition) =>
    defineApplicationTool({
      ...definition,
      revision: "web-automation-v1",
      autoApprove: () => readOnlyTools.has(definition.name),
      parse(input: unknown) {
        if (input === undefined) return {}
        if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Expected browser arguments")
        return input
      },
      async execute(args, { sessionId, signal }) {
        signal.throwIfAborted()
        const cancel = () => {
          void invoke("web_automation_cancel", { sessionId }).catch(console.error)
        }
        signal.addEventListener("abort", cancel, { once: true })
        try {
          const result = await invoke("web_automation_execute", { sessionId, name: definition.name, args })
          signal.throwIfAborted()
          return { success: true, contentItems: [{ type: "text", text: JSON.stringify(result) }] }
        } finally {
          signal.removeEventListener("abort", cancel)
        }
      }
    })
  )
}
