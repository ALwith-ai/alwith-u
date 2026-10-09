import { CodexMarkdownRenderer, type MarkdownHost } from "@alwith/module-chat/markdown"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

afterEach(cleanup)

describe("Desktop Markdown through the shared chat package", () => {
  const host: MarkdownHost = { theme: "light", copyLabel: "Copy", openLink: () => {} }

  test("renders Desktop formatting with the host's file-link action", () => {
    const openLink = vi.fn(() => {})
    const view = render(
      <CodexMarkdownRenderer text="**Shared** [file](/tmp/readme.md:12)" host={{ ...host, openLink }} />
    )
    expect(view.container.querySelector("strong")?.textContent).toBe("Shared")
    fireEvent.click(view.getByRole("link", { name: "file" }))
    expect(openLink).toHaveBeenCalledWith("/tmp/readme.md:12")
  })

  test("rejects active links without asking the host to open them", () => {
    const view = render(<CodexMarkdownRenderer text="[bad](javascript:alert%281%29)" host={host} />)
    expect(view.queryByRole("link")).toBeNull()
    expect(view.container.textContent).toBe("bad")
  })

  test("updates final text and keeps the Desktop token-tree classes", () => {
    const view = render(<CodexMarkdownRenderer text="First" host={host} />)
    view.rerender(<CodexMarkdownRenderer text="Second **answer**" host={host} />)
    expect(view.container.querySelector(".codex-markdown-content")?.textContent).toBe("Second answer")
    expect(view.container.querySelector("strong")?.textContent).toBe("answer")
  })
})
