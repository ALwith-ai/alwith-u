import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { toast } from "sonner"
import { initI18n } from "@/lib/i18n"
import { GuideButton } from "../guide-button"
import { openGuideWindow } from "../guide-window"

vi.mock("../guide-window", () => ({ openGuideWindow: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(openGuideWindow).mockReset()
})

test("help opens an ordered menu and keyboard shortcuts open the existing reference", async () => {
  await initI18n("zh-CN")
  const view = render(<GuideButton />)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "帮助" })))
  expect(view.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["键盘快捷键", "用户指南"])
  expect(openGuideWindow).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "键盘快捷键" })))
  expect(view.getByRole("dialog", { name: "键盘快捷键" })).toBeVisible()
  expect(view.getByText("新聊天")).toBeVisible()
  expect(openGuideWindow).not.toHaveBeenCalled()
})

test("the user guide menu action opens the guide and reports failures", async () => {
  await initI18n("en")
  const open = vi.mocked(openGuideWindow).mockResolvedValueOnce()
  const report = vi.spyOn(toast, "error").mockImplementation(() => "toast")
  const view = render(<GuideButton />)
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Help" })))
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "User guide" })))
  await waitFor(() => expect(open).toHaveBeenCalledOnce())
  open.mockRejectedValueOnce(new Error("Cannot open guide"))
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Help" })))
  await act(async () => fireEvent.click(view.getByRole("menuitem", { name: "User guide" })))
  await waitFor(() => expect(report).toHaveBeenCalledWith("Cannot open guide"))
})
