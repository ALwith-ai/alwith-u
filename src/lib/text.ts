/** 把任意值变成可展示的文字:字符串原样,Error 取 message,原始类型按 String,其余 JSON;空值为空串。 */
export function text(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.message
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  if (value === null || value === undefined) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/** 把 catch 到的任意值变成 Error:已是 Error 原样,否则用 text() 做 message。jsdom 的 DOMException 不继承 Error,单独认。 */
export function asError(value: unknown): Error {
  return value instanceof Error || value instanceof DOMException ? value : new Error(text(value))
}
