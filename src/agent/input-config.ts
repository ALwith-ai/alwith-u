type InputJson = null | string | number | boolean | InputJson[] | { [key: string]: InputJson }
export type SessionInputConfig = { mode: string; config: { [key: string]: InputJson } }
export type SessionInputConfigSnapshot = { sessionId: string; revision: number; inputConfig: SessionInputConfig | null }

function inputJson(value: unknown, depth = 0): InputJson {
  if (depth > 32) throw new Error("Session input config is too deeply nested")
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => inputJson(item, depth + 1))
  if (
    value &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, inputJson((value as Record<string, unknown>)[key], depth + 1)])
    )
  throw new Error("Session input config must contain only JSON values")
}

/** Storage validates the envelope, never a mode's business settings or tool policy. */
export function parseInputConfig(value: unknown): SessionInputConfig {
  if (
    !value ||
    typeof value !== "object" ||
    !("mode" in value) ||
    typeof value.mode !== "string" ||
    !value.mode.trim() ||
    value.mode.length > 128 ||
    /\p{Cc}/u.test(value.mode) ||
    !("config" in value) ||
    !value.config ||
    typeof value.config !== "object" ||
    Array.isArray(value.config)
  )
    throw new Error("Expected session input configuration with mode and config")
  const config = inputJson(value.config) as SessionInputConfig["config"]
  const result = { mode: value.mode, config }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 64 * 1024)
    throw new Error("Session input config exceeds 64 KiB")
  return result
}

export function parseInputSnapshot(value: unknown, sessionId: string): SessionInputConfigSnapshot {
  if (
    !value ||
    typeof value !== "object" ||
    !("sessionId" in value) ||
    value.sessionId !== sessionId ||
    !("revision" in value) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !("inputConfig" in value)
  )
    throw new Error("Invalid Codex session input snapshot")
  return {
    sessionId,
    revision: value.revision,
    inputConfig: value.inputConfig === null ? null : parseInputConfig(value.inputConfig)
  }
}
