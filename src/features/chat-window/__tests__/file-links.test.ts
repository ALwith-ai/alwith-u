import * as opener from "@tauri-apps/plugin-opener"
import { beforeEach, expect, test, vi } from "vitest"

import { resolveChatDriveFile } from "@/lib/chat-window"

import { openChatWindowFile } from "../file-links"

vi.mock("@/lib/chat-window", () => ({ resolveChatDriveFile: vi.fn() }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn(), revealItemsInDir: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

test("ordinary floating chat links use the system path opener without asking the main window", async () => {
  await openChatWindowFile("/project/report.html", "chat-session")
  expect(opener.openPath).toHaveBeenCalledExactlyOnceWith("/project/report.html")
  expect(resolveChatDriveFile).not.toHaveBeenCalled()
})

test("a floating cloud link follows the resolved local target", async () => {
  vi.mocked(resolveChatDriveFile).mockResolvedValue({ type: "file", path: "/project/report.pdf" })
  await openChatWindowFile("/project/report.pdf.yupcloud", "chat-session")
  expect(resolveChatDriveFile).toHaveBeenCalledExactlyOnceWith("chat-session", "/project/report.pdf.yupcloud")
  expect(opener.openPath).toHaveBeenCalledExactlyOnceWith("/project/report.pdf")
})

test("a floating cloud link follows a web target and respects cancellation", async () => {
  vi.mocked(resolveChatDriveFile)
    .mockResolvedValueOnce({ type: "web", url: "https://example.com/report" })
    .mockResolvedValueOnce(null)
  await openChatWindowFile("/project/report.pdf.yupcloud", "chat-session")
  await openChatWindowFile("/project/report.pdf.yupcloud", "chat-session")
  expect(opener.openUrl).toHaveBeenCalledExactlyOnceWith("https://example.com/report")
  expect(opener.openPath).not.toHaveBeenCalled()
})
