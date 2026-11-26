function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/")
}

/** File-tree paths use forward slashes, but Win32 extended paths require native separators. */
export function codexWorkingDirectory(cwd: string): string {
  return /^[/\\]{2}\?[/\\][A-Za-z]:[/\\]/.test(cwd) ? cwd.replaceAll("/", "\\") : cwd
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
