import { expect, test } from "bun:test"

import { loadAppEnv, parseAppEnv } from "../app-env"

const development = {
  apiBaseUrl: "https://api-dev.alwith.ai/service",
  webSsoBaseUrl: "https://www-dev.alwith.ai"
}

test("development and production load distinct endpoints despite Bun's inherited variables", () => {
  const original = process.env.VITE_API_BASE_URL
  process.env.VITE_API_BASE_URL = development.apiBaseUrl
  try {
    expect(loadAppEnv("development")).toEqual(development)
    expect(loadAppEnv("production")).toEqual({
      apiBaseUrl: "https://api.alwith.ai/service",
      webSsoBaseUrl: "https://www.alwith.ai"
    })
    expect(process.env.VITE_API_BASE_URL).toBe(development.apiBaseUrl)
  } finally {
    if (original === undefined) delete process.env.VITE_API_BASE_URL
    else process.env.VITE_API_BASE_URL = original
  }
})

test("missing or invalid endpoints fail without exposing their values", () => {
  const valid = { VITE_API_BASE_URL: development.apiBaseUrl, VITE_WEB_SSO_BASE_URL: development.webSsoBaseUrl }
  for (const value of [
    undefined,
    "",
    "not-a-url",
    "http://example.test",
    "https://secret@example.test",
    "https://example.test?key=secret",
    "https://example.test/#secret"
  ]) {
    expect(() => parseAppEnv({ ...valid, VITE_API_BASE_URL: value })).toThrow("Invalid VITE_API_BASE_URL")
  }
  expect(() => parseAppEnv({ ...valid, VITE_WEB_SSO_BASE_URL: undefined })).toThrow("Invalid VITE_WEB_SSO_BASE_URL")
})

test("environment loading rejects an unconfigured mode instead of falling back", () => {
  expect(() => loadAppEnv("staging")).toThrow("Unsupported application environment: staging")
})
