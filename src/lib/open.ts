import { openPath, openUrl } from "@tauri-apps/plugin-opener"

export function fileLocationPath(value: string): string {
  const path = value.replace(/(?::\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?|#L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?)$/, "")
  // Decode escape groups independently: literal percent signs must not prevent
  // other path segments (including the owning directory) from being decoded.
  return path.replace(/(?:%[\da-f]{2})+/gi, encoded => {
    try {
      return decodeURIComponent(encoded)
    } catch (error: unknown) {
      if (error instanceof URIError) return encoded
      throw error
    }
  })
}

export function openExternal(url: string): Promise<void> {
  if (/^file:/i.test(url)) {
    const file = new URL(url)
    let path = fileLocationPath(file.pathname)
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    if (file.hostname && file.hostname !== "localhost") path = `//${file.hostname}${path}`
    return openPath(path)
  }
  if (url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url) || url.startsWith("\\\\"))
    return openPath(fileLocationPath(url))
  return openUrl(url)
}
