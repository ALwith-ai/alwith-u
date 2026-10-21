import type { Mock } from "vitest"

/** Reads a mocked method off its owner without detaching it as an unbound method. */
export function mockOf<Owner, Key extends keyof Owner>(
  owner: Owner,
  key: Key
): Owner[Key] extends (...args: infer Args) => infer Result ? Mock<(...args: Args) => Result> : never {
  return owner[key] as unknown as Owner[Key] extends (...args: infer Args) => infer Result
    ? Mock<(...args: Args) => Result>
    : never
}
