import { isNativeError } from "@alwith/module-extension/commands"
import * as legacy from "@alwith/module-extension/legacy"

function throwLegacyDataError(error: unknown): never {
  if (error instanceof Error || !isNativeError(error)) throw error
  throw Object.assign(new Error(error.message, { cause: error }), {
    code: error.code
  })
}

/** Legacy plugins display Error.message and inspect code when resolving write conflicts. */
const createLegacyExtension: typeof legacy.createLegacyExtension = (context, definition) => {
  return legacy.createLegacyExtension(
    {
      ...context,
      data: {
        subscribe: (listener) => context.data.subscribe(listener),
        read: () => context.data.read().catch(throwLegacyDataError),
        write: (...args) => context.data.write(...args).catch(throwLegacyDataError)
      }
    },
    definition
  )
}

export const legacyModule = { ...legacy, createLegacyExtension }
