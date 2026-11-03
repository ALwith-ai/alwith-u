import { isNativeError } from "@alwith/module-chat/commands"

/**
 * Any value as displayable text: strings as is, an Error or a native module error (`{code, message}`)
 * by its message, primitives by String, everything else as JSON; null and undefined are empty.
 */
export function text(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.message
  if (isNativeError(value)) return value.message
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (value === null || value === undefined) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/** Any caught value as an Error: an Error as is, otherwise text() as the message. jsdom's DOMException does not extend Error. */
export function asError(value: unknown): Error {
  return value instanceof Error || value instanceof DOMException ? value : new Error(text(value))
}
