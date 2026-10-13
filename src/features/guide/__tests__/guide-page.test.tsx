import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"
import { GuidePage } from "../guide-page"

vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }))
vi.mock("@alwith/module-chat/markdown", () => ({
  CodexMarkdownRenderer: ({ text }: { text: string }) => <div>{text}</div>
}))
afterEach(cleanup)

test("home cards and the interface map open chapters and return to the guide home", () => {
  const view = render(<GuidePage />)
  fireEvent.click(view.getByRole("button", { name: "Open files" }))
  expect(view.getByRole("main", { name: "Work with project files" })).toBeTruthy()
  fireEvent.click(view.getByRole("button", { name: "Guide home" }))
  fireEvent.click(view.getByRole("button", { name: "Read: Choose a model" }))
  expect(view.getByRole("main", { name: "Choose a model" })).toBeTruthy()
  fireEvent.click(view.getByRole("button", { name: "Next Work with project files" }))
  expect(view.getByRole("main", { name: "Work with project files" })).toBeTruthy()
})

test("the bundled English guide starts at welcome and navigates to complete chapters", () => {
  const view = render(<GuidePage />)
  expect(view.getByRole("main", { name: "Welcome" }).textContent).toContain("independent desktop client")
  for (const chapter of [
    "Start here",
    "Find your way around",
    "Chat and review work",
    "Choose a model",
    "Work with project files",
    "Plugins and extensions",
    "Cloud files and Vibemon",
    "Settings and shortcuts",
    "Troubleshooting"
  ]) {
    const button = view.getByRole("button", { name: chapter })
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-current", "page")
    expect(view.getByRole("main", { name: chapter }).textContent?.length).toBeGreaterThan(200)
    expect(view.queryByRole("main", { name: "Welcome" })).toBeNull()
  }
})
