function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/")
}

/**
 * Last path segment (file or folder name), cross-platform: `\` is normalised to `/` first,
 * so `C:\Users\foo\bar` and `/Users/foo/bar` both give `bar`. A trailing separator is
 * trimmed; an all-empty result falls back to the input.
 */
export function basename(p: string): string {
  if (!p) return p
  const normalized = normalizeSlashes(p).replace(/\/+$/, "")
  const last = normalized.split("/").pop()
  return last && last.length > 0 ? last : p
}

/**
 * Lower-case extension without the dot, or "" when there is none. The dot has to sit
 * inside the name (index > 0), which excludes dotfiles like `.gitignore`.
 */
export function fileExtension(p: string): string {
  const name = basename(p)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}
