import { expect, test } from "vitest"

import { formatEditableShortcut, parseEditableShortcut } from "../shortcut-formatter"

test.each(["Alt+Space", "CommandOrControl+Alt+K", "Alt+Space|Control+K", "", "Control+K"])(
  "displaying %s preserves its native accelerator on save",
  (shortcut) => {
    expect(parseEditableShortcut(formatEditableShortcut(shortcut))).toBe(shortcut)
  }
)

test("the editable Alt label uses Option/Alt", () => {
  expect(formatEditableShortcut("Alt+Space")).toBe("Option/Alt+Space")
  expect(parseEditableShortcut(" Option/Alt+Space ")).toBe("Alt+Space")
})
