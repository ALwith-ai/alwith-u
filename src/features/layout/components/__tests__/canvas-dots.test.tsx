import { cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, test } from "vitest"

import { initI18n } from "@/lib/i18n"

import { CanvasDots } from "../canvas-dots"
await initI18n("en")
afterEach(cleanup)
test("dots navigate actual screens and expose the selected page", () => {
  function Example() {
    const [selected, select] = useState(1)
    return <CanvasDots count={3} selected={selected} onSelect={select} />
  }
  const view = render(<Example />)
  const buttons = view.getAllByRole("button")
  expect(buttons[1]).toHaveAttribute("aria-current", "page")
  fireEvent.click(buttons[2])
  expect(buttons[2]).toHaveAttribute("aria-current", "page")
  fireEvent.keyDown(buttons[2], { key: "Home" })
  expect(buttons[0]).toHaveAttribute("aria-current", "page")
  expect(buttons[0]).toHaveFocus()
})
test("a single screen has no redundant navigation", () => {
  const view = render(
    <CanvasDots
      count={1}
      selected={0}
      onSelect={() => {
        throw new Error("Unexpected navigation")
      }}
    />
  )
  expect(view.queryByRole("navigation")).toBeNull()
})
