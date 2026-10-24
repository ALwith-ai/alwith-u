import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import i18n, { initI18n, LANGUAGES } from "@/lib/i18n"

import { PermissionModeSelect } from "../permission-mode-select"

const { setConfig } = vi.hoisted(() => ({ setConfig: vi.fn(async () => {}) }))
vi.mock("@/lib/client", () => ({ client: { setConfig } }))

const options = [
  {
    configId: "permissions",
    category: "mode",
    name: "Permissions",
    type: "select",
    currentValue: "agent",
    options: [
      {
        value: "read-only",
        name: "Read-only",
        description: "Requires approval to edit files and access the internet."
      },
      {
        value: "workspace-write",
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
] satisfies acp.SessionConfigOption[]

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
  expect(screen.getByText("只读")).toBeInTheDocument()
  expect(screen.queryByText("Read-only")).not.toBeInTheDocument()
  expect(screen.getByText("可读取工作区文件，编辑文件或访问互联网需要批准")).toBeInTheDocument()
  expect(screen.getByText("仅对检测到的潜在不安全操作询问")).toBeInTheDocument()
  expect(screen.getByText("谨慎使用：Codex 无需批准即可编辑工作区之外的文件和访问互联网")).toBeInTheDocument()
  expect(
    screen.getByText("完全访问").closest("[role=menuitemradio]")?.querySelector(".lucide-shield-alert")
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

test.each([
  ["只读", "read-only"],
  ["请求批准", "workspace-write"],
  ["帮我批准", "agent"],
  ["完全访问", "agent-full-access"]
])("%s sends its matching ACP mode without changing a legacy read-only session automatically", async (label, value) => {
  render(
    <PermissionModeSelect
      sessionId="chat-legacy"
      options={options.map((option) => ({ ...option, currentValue: "read-only" }))}
      disabled={false}
    />
  )
  expect(screen.getByRole("button")).toHaveTextContent("只读")
  expect(setConfig).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button"))
  expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual([
    expect.stringContaining("只读"),
    expect.stringContaining("请求批准"),
    expect.stringContaining("帮我批准"),
    expect.stringContaining("完全访问"),
    expect.stringContaining("Custom mode")
  ])
  await act(async () => fireEvent.click(screen.getByRole("menuitemradio", { name: new RegExp(`^${label}`) })))
  if (value === "read-only") expect(setConfig).not.toHaveBeenCalled()
  else expect(setConfig).toHaveBeenCalledExactlyOnceWith("chat-legacy", "permissions", value)
})

test("every supported language supplies permission mode names and descriptions", () => {
  for (const { code } of LANGUAGES) {
    for (const field of ["heading"]) {
      expect(i18n.getResource(code, "translation", `chat.permissionModes.${field}`), `${code}: ${field}`).toEqual(
        expect.any(String)
      )
    }
    for (const mode of ["readOnly", "workspaceAccess", "agent", "fullAccess"]) {
      for (const field of ["name", "description"]) {
        const value: unknown = i18n.getResource(code, "translation", `chat.permissionModes.${mode}.${field}`)
        expect(typeof value, `${code}: ${mode}.${field}`).toBe("string")
        expect(value).not.toBe("")
      }
    }
  }
})
