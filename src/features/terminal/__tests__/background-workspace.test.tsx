import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { BackgroundWorkspacePane } from "../background-workspace"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  stop: vi.fn(),
  session: {
    items: [{ kind: "tool", id: "tool-item", content: [{ type: "terminal", terminalId: "linked-terminal" }] }],
    terminals: { "linked-terminal": { output: "owned log", exitStatus: null } },
    attached: true,
    restoring: false
  }
}))
vi.mock("@/lib/client", () => ({
  client: { listBackgroundTerminals: mocks.list, stopBackgroundTerminals: mocks.stop },
  useSession: () => mocks.session
}))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
test("background output follows the protocol terminal link, remains read-only and hiding never stops a process", async () => {
  mocks.list.mockResolvedValue([{ itemId: "tool-item", processId: "pid", command: "bun dev" }])
  mocks.stop.mockResolvedValue({ stopped: ["pid"], failures: [] })
  const hide = vi.fn()
  render(<BackgroundWorkspacePane sessionId="chat-a" onClose={hide} />)
  expect(await screen.findByText("owned log")).toHaveAttribute("tabindex", "0")
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "terminal.hide" }))
  expect(hide).toHaveBeenCalledOnce()
  expect(mocks.stop).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "terminal.stopAllBackground" }))
  await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith("chat-a"))
})
