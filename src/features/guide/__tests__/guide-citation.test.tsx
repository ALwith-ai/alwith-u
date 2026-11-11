import { CodexMarkdownRenderer } from "@alwith/module-chat/markdown"
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { openExternal } from "@/lib/open"

import { openGuideWindow } from "../guide-window"

vi.mock("../guide-window", () => ({ openGuideWindow: vi.fn().mockResolvedValue(undefined) }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test("a real Markdown citation opens the matching guide chapter", async () => {
  const view = render(
    <CodexMarkdownRenderer
      text="[Model setup](alwith-docs://guide/models)"
      host={{
        theme: "light",
        copyLabel: "Copy",
        openLink: (url) => {
          void openExternal(url)
        }
      }}
    />
  )
  fireEvent.click(await view.findByRole("link", { name: "Model setup" }))
  await waitFor(() => expect(openGuideWindow).toHaveBeenCalledWith("models"))
})

test("unknown guide links fail before dispatching a window action", async () => {
  await expect(openExternal("alwith-docs://guide/missing")).rejects.toThrow("Invalid guide link")
  expect(openGuideWindow).not.toHaveBeenCalled()
})
