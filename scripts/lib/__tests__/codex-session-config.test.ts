import { expect, test } from "bun:test"

import { interactiveSessionConfig } from "../codex-session-config"

test("default-mode questions remain enabled in the session feature table", () => {
  for (const source of [undefined, ""]) {
    const config = JSON.parse(interactiveSessionConfig(source))
    expect(config.features.default_mode_request_user_input).toBe(true)
  }
})

test("enabling interactive questions preserves host and provider configuration", () => {
  const config = {
    features: { computer_use: false, default_mode_request_user_input: false },
    "features.default_mode_request_user_input": false,
    "features.computer_use": false,
    model_provider: "private-gateway",
    plugins: { "unified-computer-use@openai-bundled": { enabled: false } }
  }
  const prepared = JSON.parse(interactiveSessionConfig(JSON.stringify(config)))
  expect(prepared).toEqual({
    ...config,
    features: { ...config.features, default_mode_request_user_input: true },
    "features.default_mode_request_user_input": true
  })
})

test("invalid startup configuration fails without exposing its contents", () => {
  for (const config of ["private-secret", "null", "[]", '{"features":"private-secret"}', '{"features":[]}']) {
    expect(() => interactiveSessionConfig(config)).toThrow("Invalid Codex session configuration")
    try {
      interactiveSessionConfig(config)
    } catch (error) {
      expect(String(error)).not.toContain("private-secret")
    }
  }
})
