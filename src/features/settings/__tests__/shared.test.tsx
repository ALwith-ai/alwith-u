import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { Input } from "@/components/ui/input"

import { SettingGroup, SettingRow } from "../sections/shared"

afterEach(cleanup)

test("setting rows expose their label and description as an accessible control group", () => {
  render(
    <SettingGroup>
      <SettingRow title="Language" desc="Choose the display language" aligned>
        <Input aria-label="Language" defaultValue="English" />
      </SettingRow>
    </SettingGroup>
  )
  expect(screen.getByRole("group", { name: "Language" })).toHaveAccessibleDescription("Choose the display language")
  expect(screen.getByRole("textbox", { name: "Language" })).toHaveValue("English")
})
