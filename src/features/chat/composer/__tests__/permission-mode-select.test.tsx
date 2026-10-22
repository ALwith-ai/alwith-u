import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import i18n, { initI18n, LANGUAGES } from "@/lib/i18n"

import { PermissionModeSelect } from "../permission-mode-select"

const { setConfig } = vi.hoisted(() => ({ setConfig: vi.fn(async () => {}) }))
vi.mock("@/lib/client", () => ({ client: { setConfig } }))

const options: acp.SessionConfigOption[] = [
  {
    configId: "permissions",
    category: "mode",
    name: "Permissions",
    type: "select",
    currentValue: "agent",
    options: [
      {
        value: "read-only",
        name: "Ask for approval",
        description: "Always ask to edit external files and use the internet"
      },
      { value: "agent", name: "Approve for me", description: "Only ask for actions detected as potentially unsafe" },
      {
        value: "agent-full-access",
        name: "Full access",
        description: "Unrestricted access to the internet and any file on your computer"
      },
      { value: "custom-mode", name: "Custom mode", description: "Provider-defined policy" }
    ]
  }
]

beforeEach(async () => {
  await initI18n("zh-CN")
  setConfig.mockClear()
})
afterEach(cleanup)

test("permission names and descriptions follow language changes without changing protocol values", async () => {
  render(<PermissionModeSelect sessionId="chat-1" options={options} disabled={false} />)
  expect(screen.getByRole("button")).toHaveTextContent("帮我批准")
  fireEvent.click(screen.getByRole("button"))
  expect(screen.getByText("应如何批准 ALwith U 操作?")).toBeInTheDocument()
  expect(screen.queryByText("了解更多")).not.toBeInTheDocument()
  expect(screen.getByRole("menuitemradio", { checked: true })).toHaveTextContent("帮我批准")
  expect(screen.getByText("请求批准")).toBeInTheDocument()
  expect(screen.getByText("编辑外部文件和使用互联网时始终询问")).toBeInTheDocument()
  expect(screen.getByText("仅对检测到的风险操作请求批准")).toBeInTheDocument()
  expect(screen.getByText("可不受限制地访问互联网和你电脑上的任何文件")).toBeInTheDocument()
  expect(
    screen.getByText("完全访问权限").closest("[role=menuitemradio]")?.querySelector(".lucide-shield-alert")
  ).toBeInTheDocument()
  expect(screen.getByText("Custom mode")).toBeInTheDocument()
  expect(screen.getByText("Provider-defined policy")).toBeInTheDocument()
  await act(async () => {
    await i18n.changeLanguage("en")
  })
  expect(screen.getByRole("button")).toHaveTextContent("Approve for me")
  expect(screen.getByText("Full access")).toBeInTheDocument()
  fireEvent.click(screen.getByText("Full access"))
  expect(setConfig).toHaveBeenCalledWith("chat-1", "permissions", "agent-full-access")
  expect(options[0]?.currentValue).toBe("agent")
})

test("every supported language supplies permission mode names and descriptions", () => {
  for (const { code } of LANGUAGES) {
    for (const field of ["heading"]) {
      expect(i18n.getResource(code, "translation", `chat.permissionModes.${field}`), `${code}: ${field}`).toEqual(
        expect.any(String)
      )
    }
    for (const mode of ["readOnly", "agent", "fullAccess"]) {
      for (const field of ["name", "description"]) {
        const value: unknown = i18n.getResource(code, "translation", `chat.permissionModes.${mode}.${field}`)
        expect(typeof value, `${code}: ${mode}.${field}`).toBe("string")
        expect(value).not.toBe("")
      }
    }
  }
})
