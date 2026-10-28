import type { CodexCapabilitiesClient } from "@nyssance/codex-acp-v2/client"
import { expect, test, vi } from "vitest"

import { ImportController } from "../imports-bridge"

const item = { itemType: "AGENTS_MD", description: "Instructions", cwd: "/project", details: null }
function fixture() {
  const api = {
    detectImports: vi.fn().mockResolvedValue({ items: [item], connectors: [] }),
    importHistory: vi.fn().mockResolvedValue({ data: [], connectors: [] }),
    runImport: vi.fn().mockResolvedValue({ importId: "1", itemTypeResults: [] })
  }
  const publish = vi.fn()
  const controller = new ImportController(
    () => api as unknown as CodexCapabilitiesClient,
    () => ["/project"],
    publish
  )
  return { api, controller, publish }
}
test("imports only explicitly selected items from the detected source", async () => {
  const { api, controller } = fixture()
  await controller.dispatch({ action: "detect", source: "cursor" })
  expect(api.runImport).not.toHaveBeenCalled()
  await controller.dispatch({ action: "import", indices: [0] })
  expect(api.runImport.mock.calls[0][0]).toEqual({
    migrationItems: [item],
    migrationSource: "cursor",
    source: "alwith-u",
    providerId: "cursor"
  })
  expect(controller.state.phase).toBe("complete")
})
test("a repeated click cannot start a second import and progress remains available while settings is closed", async () => {
  const { api, controller } = fixture()
  let finish!: (value: unknown) => void
  api.runImport.mockImplementation(
    (_params: unknown, progress: Parameters<CodexCapabilitiesClient["runImport"]>[1]) => {
      progress({ importId: "1", itemTypeResults: [] })
      return new Promise((resolve) => {
        finish = resolve
      })
    }
  )
  await controller.dispatch({ action: "detect", source: "claude-code" })
  const pending = controller.dispatch({ action: "import", indices: [0] })
  await controller.dispatch({ action: "import", indices: [0] })
  await controller.dispatch({ action: "refresh" })
  expect(api.runImport).toHaveBeenCalledTimes(1)
  expect(controller.state.phase).toBe("importing")
  finish({ importId: "1", itemTypeResults: [] })
  await pending
  expect(controller.state.phase).toBe("complete")
})
test("keeps partial failures and reports disconnect without pretending completion", async () => {
  const { api, controller } = fixture()
  const results = [{ itemType: "MEMORY", successes: [], failures: [{ message: "permission denied" }] }]
  api.runImport.mockResolvedValue({ importId: "1", itemTypeResults: results })
  await controller.dispatch({ action: "detect", source: "claude-code" })
  await controller.dispatch({ action: "import", indices: [0] })
  expect(controller.state.results).toEqual(results)
  api.runImport.mockRejectedValue(new Error("Codex disconnected"))
  await controller.dispatch({ action: "detect", source: "claude-code" })
  await controller.dispatch({ action: "import", indices: [0] })
  expect(controller.state.phase).toBe("error")
  expect(controller.state.error).toBe("Codex disconnected")
})
test("rejects invalid selection before making a request", async () => {
  const { api, controller } = fixture()
  await controller.dispatch({ action: "detect", source: "cursor" })
  await controller.dispatch({ action: "import", indices: [10] })
  expect(api.runImport).not.toHaveBeenCalled()
  expect(controller.state.phase).toBe("error")
})
