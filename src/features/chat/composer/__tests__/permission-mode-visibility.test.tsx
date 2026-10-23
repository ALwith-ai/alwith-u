import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { PermissionModeSelect } from "../permission-mode-select"

const { setConfig } = vi.hoisted(() => ({ setConfig: vi.fn(async () => {}) }))
vi.mock("@/lib/client", () => ({ client: { setConfig } }))

beforeEach(async () => {
  await initI18n("zh-CN")
  setConfig.mockClear()
})
afterEach(cleanup)

test.each(["agent", "workspace-write"])(
  "hides workspace access without changing the current %s permission",
  async (currentValue) => {
    const options: acp.SessionConfigOption[] = [
      {
        configId: "mode",
        category: "mode",
        name: "Permissions",
        type: "select",
        currentValue,
        options: [
          { value: "read-only", name: "Read-only" },
          { value: "workspace-write", name: "Workspace access" },
          { value: "agent", name: "Auto review" },
          { value: "agent-full-access", name: "Full access" }
        ]
      }
    ]
    const view = render(<PermissionModeSelect sessionId="chat" options={options} disabled={false} />)
    const trigger = view.getByRole("button")
    expect(trigger).toHaveTextContent(currentValue === "workspace-write" ? "Workspace access" : "帮我批准")
    fireEvent.click(trigger)
    expect(view.queryByRole("menuitemradio", { name: "Workspace access" })).not.toBeInTheDocument()
    expect(view.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
      expect.stringContaining("请求批准"),
      expect.stringContaining("帮我批准"),
      expect.stringContaining("完全访问权限")
    ])
    expect(setConfig).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(view.getByRole("menuitemradio", { name: /^请求批准/ })))
    expect(setConfig).toHaveBeenCalledExactlyOnceWith("chat", "mode", "read-only")
    expect(options[0].currentValue).toBe(currentValue)
  }
)
