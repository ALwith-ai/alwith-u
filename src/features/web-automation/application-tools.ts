import { defineApplicationTool } from "@alwith/module-chat/client"
import { invoke } from "@tauri-apps/api/core"

import { tools } from "./definitions.mjs"

const readOnlyTools = new Set([
  "browser_list",
  "browser_read_page",
  "browser_read_elements",
  "browser_inspect",
  "browser_diagnostics",
  "browser_wait",
  "browser_snapshot",
  "browser_verify",
  "browser_screenshot",
  "browser_resolve"
])

/** Model-independent application tools; the native host owns execution and session leases. */
export function createWebAutomationTools() {
  return tools.map((definition) =>
    defineApplicationTool({
      ...definition,
      ...(readOnlyTools.has(definition.name) ? { annotations: { readOnlyHint: true } } : {}),
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
          if (definition.name === "browser_screenshot") {
            const capture = result as { image?: { mimeType: string; data: string }; pending?: boolean }
            if (capture.pending) return { content: [{ type: "text", text: JSON.stringify(result) }] }
            if (capture.image?.mimeType !== "image/png" || typeof capture.image.data !== "string")
              throw Error("Invalid browser screenshot result")
            const { image, ...metadata } = capture
            return {
              content: [
                { type: "text", text: JSON.stringify(metadata) },
                { type: "image", mimeType: image.mimeType, data: image.data }
              ]
            }
          }
          const outcome = result as { ok?: boolean; pending?: boolean } | null
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            isError: outcome?.ok === false && outcome.pending !== true
          }
        } finally {
          signal.removeEventListener("abort", cancel)
        }
      }
    })
  )
}
