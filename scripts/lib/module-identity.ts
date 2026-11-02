import type { Plugin } from "vite"

/** A Windows path separator must not create a second instance of a module. */
export function moduleIdentityGuard(): Plugin {
  return {
    name: "module-identity-guard",
    apply: "build",
    buildEnd(error) {
      if (error) return
      const identities = new Map<string, string>()
      for (const id of this.getModuleIds()) {
        if (id.startsWith("\0")) continue
        const key = id.replaceAll("\\", "/")
        const previous = identities.get(key)
        if (previous !== undefined && previous !== id) {
          this.error(`Duplicate module identity: ${previous} and ${id}. Normalize resolver paths before bundling.`)
        }
        identities.set(key, id)
      }
    }
  }
}
