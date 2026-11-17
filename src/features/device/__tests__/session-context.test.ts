import { expect, test } from "vitest"

import { deviceSessionContext } from "../session-context"

test("mobile instructions use host application tools without starting a per-session MCP carrier", async () => {
  const context = await deviceSessionContext()
  expect(context.mcpServers).toEqual([])
  expect(context.appendSystemPrompt).toContain("device_control")
  expect(context.appendSystemPrompt).toContain("device_logs")
  expect(context).not.toHaveProperty("bind")
})
