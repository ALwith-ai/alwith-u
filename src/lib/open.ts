import { normalizePath } from "@alwith/module-fs"
import { openPath, openUrl, revealItemsInDir } from "@tauri-apps/plugin-opener"

/** Windows Shell expects DOS/UNC paths rather than filesystem verbatim paths. */
function shellPath(path: string): string {
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(path)) return path
  const normalized = normalizePath(path)
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\/([A-Za-z]:\/)/, "$1")
  return normalized.replaceAll("/", "\\")
}

export function revealInFileManager(path: string): Promise<void> {
  return revealItemsInDir(shellPath(path))
}

export function fileLocationPath(value: string): string {
  const path = value.replace(/(?::\d+(?::\d+)?(?:[-–]\d+(?::\d+)?)?|#L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?)$/, "")
  // Decode escape groups independently: literal percent signs must not prevent
  // other path segments (including the owning directory) from being decoded.
  return path.replaceAll(/(?:%[\da-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded)
    } catch (error: unknown) {
      if (error instanceof URIError) return encoded
      throw error
    }
  })
}

export function openExternal(url: string): Promise<void> {
  if (url.startsWith("alwith-docs:")) {
    return Promise.all([
      import("@/features/guide/guide-window"), import("@/features/guide/guide-location")
    ]).then(([{ openGuideWindow }, { guideLinkChapter }]) => openGuideWindow(guideLinkChapter(url)))
  }
  if (/^file:/i.test(url)) {
    const file = new URL(url)
    let path = fileLocationPath(file.pathname)
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    if (file.hostname && file.hostname !== "localhost") path = `//${file.hostname}${path}`
    return openPath(shellPath(path))
  }
  if (url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url) || url.startsWith(String.raw`\\`))
    return openPath(shellPath(fileLocationPath(url)))
  return openUrl(url)
}
