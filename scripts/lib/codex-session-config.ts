function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The adapter writes a session-level features table, which replaces launcher feature overrides. */
export function interactiveSessionConfig(source: string | undefined): string {
  let config: unknown
  try {
    config = source === undefined || source === "" ? {} : JSON.parse(source)
  } catch {
    throw new Error("Invalid Codex session configuration")
  }
  if (!isRecord(config) || (config.features !== undefined && !isRecord(config.features)))
    throw new Error("Invalid Codex session configuration")
  return JSON.stringify({
    ...config,
    features: { ...(config.features as Record<string, unknown> | undefined), default_mode_request_user_input: true },
    ...("features.default_mode_request_user_input" in config
      ? { "features.default_mode_request_user_input": true }
      : {})
  })
}
