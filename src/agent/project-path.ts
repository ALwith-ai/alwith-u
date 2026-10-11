export type ProjectPaths = (cwd: string) => readonly [string, ...string[]]

/** macOS system aliases remain equivalent after a historical workspace is deleted.
 * The host opts in; these names must remain distinct on other operating systems.
 * The first spelling is the stable grouping/cache key, followed by native query aliases.
 */
export const macProjectPaths: ProjectPaths = cwd => {
  const value = cwd.startsWith("/") && cwd !== "/" ? cwd.replace(/\/+$/, "") : cwd
  const match = /^\/(?:private\/)?(var|tmp|etc)(\/.*)?$/.exec(value)
  if (!match) return [value]
  const suffix = `${match[1]}${match[2] ?? ""}`
  return [`/private/${suffix}`, `/${suffix}`]
}
