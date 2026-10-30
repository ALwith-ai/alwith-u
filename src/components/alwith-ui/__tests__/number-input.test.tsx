import { cleanup, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, expect, test } from "vitest"

import { initI18n } from "@/lib/i18n"

import { NumberInput } from "../number-input"

await initI18n("en")
afterEach(cleanup)

test("step buttons emit input changes and respect numeric bounds", () => {
  function Example() {
    const [value, setValue] = useState(13)
    return (
      <NumberInput
        aria-label="Font size"
        min={12}
        max={14}
        value={value}
        onChange={(event) => setValue(event.target.valueAsNumber)}
      />
    )
  }
  const view = render(<Example />)
  const field = view.getByRole("spinbutton", { name: "Font size" })
  const increase = view.getByRole("button", { name: "Increase Font size" })
  const decrease = view.getByRole("button", { name: "Decrease Font size" })
  fireEvent.click(increase)
  expect(field).toHaveValue(14)
  expect(increase).toBeDisabled()
  fireEvent.click(decrease)
  fireEvent.click(decrease)
  expect(field).toHaveValue(12)
  expect(decrease).toBeDisabled()
})
