import { expect, test } from "bun:test"
import { assertActiveLogin } from "../login-response"

const response = {
  user_uuid: "user",
  nickname: "",
  login_email: "user@example.test",
  access_token: "access",
  refresh_token: "refresh"
}
test("accepts Desktop's active and legacy successful login responses", () => {
  expect(() => assertActiveLogin(response)).not.toThrow()
  expect(() => assertActiveLogin({ ...response, status: "ACTIVE" })).not.toThrow()
})
test("waitlisted, disabled and malformed responses cannot open the app or persist tokens", () => {
  for (const status of ["WAITLISTED", "DISABLED", "UNKNOWN", null])
    expect(() => assertActiveLogin({ ...response, status })).toThrow()
  for (const value of [null, {}, { ...response, refresh_token: "" }, { ...response, user_uuid: 42 }])
    expect(() => assertActiveLogin(value)).toThrow()
})
