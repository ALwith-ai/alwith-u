import { beforeEach, expect, test, vi } from "vitest"

import { closeConversationTerminals, rememberTerminalViews, restoreTerminalViews } from "../view-preferences"
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
  register: vi.fn(),
  rename: vi.fn(),
  closeSession: vi.fn()
}))
vi.mock("@/lib/store", () => ({ openStore: () => ({ get: mocks.get, set: mocks.set, delete: mocks.delete }) }))
vi.mock("@alwith/module-terminal/tauri", () => ({ terminalClient: mocks }))
beforeEach(() => vi.clearAllMocks())
test("view preferences exclude headless relaunches, logs, commands and environments", async () => {
  mocks.list.mockResolvedValue([
    {
      terminalId: "view",
      cwd: "/project",
      shell: "/bin/sh",
      title: "Build",
      interactive: true,
      command: "secret",
      env: { TOKEN: "private" },
      text: "output"
    },
    { terminalId: "headless", interactive: false }
  ])
  await rememberTerminalViews("a", "view")
  expect(mocks.set).toHaveBeenCalledWith("a", {
    version: 1,
    activeId: "view",
    tabs: [{ terminalId: "view", cwd: "/project", shell: "/bin/sh", title: "Build" }]
  })
})
test("explicit development view restoration registers metadata without starting shells and reuses live instances", async () => {
  mocks.get.mockResolvedValue({
    version: 1,
    activeId: "saved",
    tabs: [
      { terminalId: "live", cwd: "/project", shell: "/bin/sh", title: "Live" },
      { terminalId: "saved", cwd: "/project", shell: "/bin/sh", title: "Build" }
    ]
  })
  mocks.list.mockResolvedValue([{ terminalId: "live" }])
  mocks.register.mockResolvedValue({ terminalId: "saved", title: "sh" })
  await expect(restoreTerminalViews("a")).resolves.toBe("saved")
  expect(mocks.register).toHaveBeenCalledExactlyOnceWith({
    sessionId: "a",
    terminalId: "saved",
    cwd: "/project",
    shell: "/bin/sh"
  })
  expect(mocks.rename).toHaveBeenCalledWith(expect.objectContaining({ terminalId: "saved" }), "Build")
})
test("conversation cleanup removes descriptors only after native cleanup succeeds", async () => {
  mocks.closeSession.mockRejectedValueOnce(new Error("child still running"))
  await expect(closeConversationTerminals("a")).rejects.toThrow("child still running")
  expect(mocks.delete).not.toHaveBeenCalled()
  mocks.closeSession.mockResolvedValueOnce(undefined)
  await closeConversationTerminals("a")
  expect(mocks.delete).toHaveBeenCalledExactlyOnceWith("a")
})
