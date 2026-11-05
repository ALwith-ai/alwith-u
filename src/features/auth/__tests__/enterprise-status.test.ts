import { expect, test } from "vitest"

import { enterpriseLoginAvailable, parseEnterpriseRenewal } from "../enterprise-status"

test("server authorization requires local automatic renewal before models are usable", () => {
  const server = { enabled: true, authorization_status: "authorized" }
  expect(enterpriseLoginAvailable(server, { automatic_renewal: true, requires_login: false, error: null })).toBe(true)
  expect(enterpriseLoginAvailable(server, { automatic_renewal: false, requires_login: false, error: null })).toBe(false)
  expect(
    enterpriseLoginAvailable(server, { automatic_renewal: true, requires_login: true, error: "invalid_grant" })
  ).toBe(false)
  expect(
    enterpriseLoginAvailable(
      { ...server, enabled: false },
      { automatic_renewal: true, requires_login: false, error: null }
    )
  ).toBe(false)
})

test("invalid native status is reported instead of looking like a signed-out account", () => {
  expect(() => parseEnterpriseRenewal({})).toThrow()
  expect(parseEnterpriseRenewal({ automatic_renewal: false, requires_login: false, error: null })).toEqual({
    automatic_renewal: false,
    requires_login: false,
    error: null
  })
})
