import { CodexMarkdownRenderer, type MarkdownHost } from "@alwith/module-chat/markdown"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
  expect(view.container.querySelector(".codex-markdown-inline-code")?.textContent).toBe(String.raw`\(literal\)`)
  expect(view.container.textContent).toContain("Price $10 and $20")
})

test("code-block copy waits for the host clipboard and reports failures without confirming success", async () => {
  vi.stubGlobal("IntersectionObserver", undefined)
  let finish!: () => void
  const copyText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const onCopyError = vi.fn()
  const host: MarkdownHost = { theme: "light", copyLabel: "Copy code", openLink: () => {}, copyText, onCopyError }
  const view = render(<CodexMarkdownRenderer text={"```js\nconst value = 42\n```"} host={host} />)
  const button = await view.findByRole("button", { name: "Copy code" })
  fireEvent.click(button)
  await waitFor(() => expect(copyText).toHaveBeenCalledWith("const value = 42"))
  expect(button.querySelector(".lucide-check")).toBeNull()
  await act(() => Promise.try(() => finish()))
  expect(button.querySelector(".lucide-check")).not.toBeNull()
  const failure = new Error("Native clipboard unavailable")
  copyText.mockRejectedValueOnce(failure)
  fireEvent.click(button)
  await waitFor(() => expect(onCopyError).toHaveBeenCalledWith(failure))
  expect(button.querySelector(".lucide-check")).toBeNull()
})
