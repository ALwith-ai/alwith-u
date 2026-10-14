import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { toast } from "sonner"
import { initI18n } from "@/lib/i18n"
import { GuideButton } from "../guide-button"
import { openGuideWindow } from "../guide-window"

vi.mock("../guide-window", () => ({ openGuideWindow: vi.fn() }))
await initI18n("en")
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test("the guide icon opens the guide directly and reports failures", async () => {
  const open = vi.mocked(openGuideWindow).mockResolvedValueOnce()
  const report = vi.spyOn(toast, "error").mockImplementation(() => "toast")
  const view = render(<GuideButton />)
  fireEvent.click(view.getByRole("button", { name: "ALwith U Guide" }))
  await waitFor(() => expect(open).toHaveBeenCalledOnce())
  open.mockRejectedValueOnce(new Error("Cannot open guide"))
  fireEvent.click(view.getByRole("button", { name: "ALwith U Guide" }))
  await waitFor(() => expect(report).toHaveBeenCalledWith("Cannot open guide"))
})
