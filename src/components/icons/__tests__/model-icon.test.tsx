import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { ModelIcon } from "../model-icon"
afterEach(cleanup)

test.each([
  ["chatgpt", "0 0 24 24", "currentColor"],
  ["seedream", "0 0 24 24", "#00E5E5"],
  ["minimax", "0 0 24 24", null],
  ["alwith-account", "-3 -3 30 30", "currentColor"],
  ["alwith-enterprise", "-3 -3 30 30", "#ee305a"]
])("renders %s as an SVG component", (provider, viewBox, fill) => {
  const view = render(<ModelIcon provider={provider} data-testid="model-icon" aria-label="Model" aria-hidden={false} />)
  const icon = view.getByTestId("model-icon")
  expect(icon.tagName).toBe("svg")
  expect(icon).toHaveAttribute("viewBox", viewBox)
  expect(icon).toHaveAttribute("aria-label", "Model")
  expect(icon).toHaveAttribute("aria-hidden", "false")
  expect(icon).toHaveClass("size-4", "shrink-0")
  expect(icon).not.toHaveClass("dark:invert")
  expect(icon.querySelector("path")).not.toBeNull()
  if (fill) expect(icon.querySelector("path")?.getAttribute("fill") ?? icon.getAttribute("fill")).toBe(fill)
})

test("keeps MiniMax gradients independent between instances", () => {
  const view = render(
    <>
      <ModelIcon provider="minimax" />
      <ModelIcon provider="minimax" />
    </>
  )
  const icons = [...view.container.querySelectorAll("svg")]
  const ids = icons.map((icon) => icon.querySelector("linearGradient")!.id)
  expect(ids[0]).not.toBe(ids[1])
  icons.forEach((icon, index) => expect(icon.querySelector("path")).toHaveAttribute("fill", `url(#${ids[index]})`))
})

test("renders shared providers and unknown providers at the requested size", () => {
  const shared = render(<ModelIcon provider="qwen" className="size-6" />)
  expect(shared.container.querySelector("svg")).toHaveClass("size-6", "shrink-0")
  const unknown = render(<ModelIcon provider="toString" />)
  expect(unknown.container.querySelector("svg")).toHaveClass("lucide-bot", "size-4")
})
