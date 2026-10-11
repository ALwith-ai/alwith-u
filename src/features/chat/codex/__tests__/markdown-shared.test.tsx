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

test("renders dollar and backslash math while preserving code examples and currency", () => {
  const view = render(
    <CodexMarkdownRenderer
      host={{ theme: "dark", copyLabel: "Copy", openLink: () => {} }}
      text={String.raw`Inline $x^2$ and \(a+b\).

$$\int_0^1 x^2 dx=\frac{1}{3}$$

\[\begin{pmatrix}1&2\\3&4\end{pmatrix}\]

Price $10 and $20. Code: ${"`\\(literal\\)`"}`}
    />
  )
  expect(view.container.querySelectorAll(".katex")).toHaveLength(4)
  expect(view.container.querySelectorAll(".katex-display")).toHaveLength(2)
  expect(view.container.querySelector(".codex-markdown-inline-code")?.textContent).toBe("\\(literal\\)")
  expect(view.container.textContent).toContain("Price $10 and $20")
})
