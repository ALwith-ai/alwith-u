import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { join } from "node:path"

import type { ObjectValue } from "./native"

const scheme = "alwith-generated-image:"
const reference =
  /^generated_images\/([a-zA-Z0-9_-]{1,160})\/(alwith-[a-zA-Z0-9_-]{1,160}-(?:[1-9]|1[0-6])\.(png|jpg|webp))$/
const pngHeader = Buffer.from("89504e470d0a1a0a", "hex")

export function generatedImageLinks(item: ObjectValue): string[] {
  if (item.type !== "mcpToolCall" || item.server !== "alwith" || item.tool !== "generate_image") return []
  const result = item.result as { content?: unknown } | undefined
  if (!Array.isArray(result?.content)) return []
  return result.content
    .flatMap((block) =>
      block?.type === "resource_link" && typeof block.uri === "string" && block.uri.startsWith(scheme)
        ? [block.uri.slice(scheme.length)]
        : []
    )
    .slice(0, 16)
}

export async function readGeneratedImage(session: string, path: string, signal: AbortSignal): Promise<ObjectValue> {
  const match = reference.exec(path)
  const home = process.env.CODEX_HOME
  const mimeType = match?.[3] === "jpg" ? "image/jpeg" : match?.[3] === "webp" ? "image/webp" : "image/png"
  const unavailable = { type: "image", mimeType }
  if (!home || !match || match[0] !== path || match[1] !== session) return unavailable
  const root = join(home, "generated_images")
  const folder = join(root, session)
  try {
    if (!(await lstat(root)).isDirectory() || !(await lstat(folder)).isDirectory()) return unavailable
    const filePath = join(folder, match[2])
    if (!(await lstat(filePath)).isFile()) return unavailable
    const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size < 3 || info.size > 32 * 1024 * 1024) return unavailable
      const bytes = Buffer.alloc(info.size)
      let offset = 0
      while (offset < bytes.length) {
        signal.throwIfAborted()
        const { bytesRead } = await file.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset)
        if (!bytesRead) return unavailable
        offset += bytesRead
      }
      const valid =
        match[3] === "png"
          ? bytes.subarray(0, 8).equals(pngHeader)
          : match[3] === "jpg"
            ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
            : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
      return valid ? { ...unavailable, data: bytes.toString("base64") } : unavailable
    } finally {
      await file.close()
    }
  } catch (error) {
    signal.throwIfAborted()
    if (["ENOENT", "ELOOP", "EACCES", "ENOTDIR", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
      return unavailable
    throw error
  }
}
