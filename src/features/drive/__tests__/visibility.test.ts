import { expect, test } from "vitest"
import { isDriveVisible } from "../visibility"

test.each([
  [false, "user@finture.id", false],
  [true, "user@finture.id", true],
  [true, "USER@FINTURE.ID", true],
  [true, "user@finture.id.example.com", false],
  [true, "user@sub.finture.id", false],
  [true, null, false]
])("Drive visibility follows the authenticated email", (authenticated, email, expected) => {
  expect(isDriveVisible(authenticated, email)).toBe(expected)
})
