import { containsPath, dirname, normalizePath, type FileSystem } from "@alwith/module-fs"
import type { PreviewResource } from "@alwith/module-editor/previews"

const mimeTypes: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg"
}
/** Native FS remains the authority for canonical and symlink boundaries. */
export async function resolvePreviewResource(
  fs: FileSystem,
  root: string,
  documentPath: string,
  reference: string
): Promise<PreviewResource> {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) throw new Error("Preview resource must be a local project file")
  const decoded = decodeURIComponent(reference.split(/[?#]/, 1)[0])
  const path = normalizePath(decoded.startsWith("/") ? `${root}/${decoded}` : `${dirname(documentPath)}/${decoded}`)
  if (!containsPath(root, documentPath) || !containsPath(root, path))
    throw new Error("Preview resource is outside the project")
  const bytes = await fs.readFile(path)
  const extension = path.split(".").at(-1)?.toLowerCase() ?? ""
  return { bytes, path, mimeType: mimeTypes[extension] ?? "application/octet-stream" }
}
