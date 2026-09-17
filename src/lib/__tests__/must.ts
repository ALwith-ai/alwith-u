/** Narrows a nullable value a test expects to exist; the message names what was expected. */
export function must<T>(value: T | null | undefined, expected: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${expected}`)
  return value
}
