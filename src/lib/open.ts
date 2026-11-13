import { dirname, normalizePath } from "@alwith/module-fs"
import { commands as fsCommands } from "@alwith/module-fs/commands"
import { commands as installedApps } from "@alwith/module-installed-apps/commands"
import { openPath, openUrl, revealItemsInDir } from "@tauri-apps/plugin-opener"

/** Windows Shell expects DOS/UNC paths rather than filesystem verbatim paths. */
function shellPath(path: string): string {
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/\/)/.test(path)) return path
  const normalized = normalizePath(path)
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\/([A-Za-z]:\/)/, "$1")
  return normalized.replaceAll("/", "\\")
}

/** Use the configured browser even when HTML files are associated with an editor. */
export async function openHtmlInBrowser(path: string): Promise<void> {
  const browser = await installedApps.defaultBrowser()
  if (browser === null) throw new Error("No default browser is configured")
  const bundleId =
    browser.bundle_id ?? (await installedApps.readAppsInfo({ names: [browser.name], withIcons: false }))[0]?.bundle_id
  if (!bundleId) throw new Error(`Default browser is unavailable: ${browser.name}`)
  await installedApps.openPathInApp({ bundleId, path })
}

/** Route an entry outside the owning chat project through system applications. */
export async function openExternalEntry(path: string): Promise<void> {
  const root = await fsCommands.workspaceOpen({ path: dirname(path) })
  const stat = await fsCommands.workspaceStat({ root, path })
  if (stat === null) throw new Error(`Path does not exist: ${path}`)
  if (stat.kind === "directory") await openLocalPath(path)
  else if (/\.html?$/i.test(path)) await openHtmlInBrowser(path)
  else await revealInFileManager(path)
}

/** Open an already-decoded filesystem path with its system association. */
export function openLocalPath(path: string): Promise<void> {
  return openPath(shellPath(path))
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
    return Promise.all([import("@/features/guide/guide-window"), import("@/features/guide/guide-location")]).then(
      ([{ openGuideWindow }, { guideLinkChapter }]) => openGuideWindow(guideLinkChapter(url))
    )
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
