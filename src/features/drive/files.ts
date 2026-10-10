import { prepareDriveFile } from "@alwith/module-drive"
import { driveFileWebUrl, isYuplinkName, parseYuplink } from "@alwith/module-drive/content"
import { confirm } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { openExternal } from "@/lib/open"
import { drive } from "./controller"
import { driveFileSystem } from "./filesystem"

export interface WorkspaceFileHost {
  readFile(path: string): Promise<Uint8Array>
  openTarget(path: string): Promise<void>
}

export function safeDriveWebUrl(raw: string): string {
  const url = new URL(raw)
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Drive shortcut has no safe web destination")
  }
  return url.href
}

/** Resolve shortcut identity from the native index; shortcut names and stored URLs may be stale. */
export async function prepareWorkspaceFile(path: string, host?: WorkspaceFileHost): Promise<string | null> {
  const generation = drive.getSnapshot().snapshot?.generation
  const checkProfile = (): void => {
    if (drive.getSnapshot().snapshot?.generation !== generation) {
      throw new Error("Drive profile changed while opening the shortcut")
    }
  }
  const visitedPaths = new Set<string>()
  const visitedIds = new Set<string>()
  let redirected = false
  for (let hops = 0; hops < 16; hops++) {
    const local = await prepareDriveFile(drive, path, {
      maxEditorBytes: 16 * 1024 * 1024,
      confirmDownload: async (name, bytes) => {
        const accepted = await confirm(
          `Download ${name} (${bytes} bytes)? Files larger than 16 MiB open in the system application.`,
          {
            title: "Drive"
          }
        )
        checkProfile()
        return accepted
      },
      openExternal: async destination => {
        checkProfile()
        await openExternal(destination)
      }
    })
    if (local === null) return null
    if (redirected || isYuplinkName(local)) checkProfile()
    if (!isYuplinkName(local)) {
      if (redirected && host) {
        await host.openTarget(local)
        return null
      }
      return local
    }
    const key = local.replaceAll("\\", "/")
    if (visitedPaths.has(key)) throw new Error("Drive shortcut loop detected")
    visitedPaths.add(key)
    const fs = host ?? (await driveFileSystem(local))
    checkProfile()
    const bytes = await fs.readFile(local)
    checkProfile()
    if (bytes.byteLength > 64 * 1024) throw new Error("Drive shortcut exceeds the size limit")
    const target = parseYuplink(new TextDecoder().decode(bytes))
    if (!target) throw new Error("Drive shortcut is damaged")
    const id = String(target.targetFileId)
    if (visitedIds.has(id)) throw new Error("Drive shortcut loop detected")
    visitedIds.add(id)
    let destination: string | null = null
    let lookupError: unknown
    try {
      const response = await drive.request({ type: "localPath", fileId: target.targetFileId })
      if (response.type !== "path") throw new Error("Invalid Drive local path response")
      destination = response.data
    } catch (error) {
      lookupError = error
    }
    checkProfile()
    if (destination !== null) {
      redirected = true
      path = destination
      continue
    }
    const webBase = drive.getSnapshot().snapshot?.webBaseUrl
    const webUrl = webBase ? driveFileWebUrl(webBase, target.targetFileId) : target.webUrl
    if (!webUrl)
      throw new Error("Drive shortcut target is unavailable locally and has no web destination", { cause: lookupError })
    const safe = safeDriveWebUrl(webUrl)
    toast.info(
      lookupError
        ? "Drive lookup is unavailable; opening the file on the web"
        : "This file is not available locally; opening it on the web"
    )
    await openExternal(safe)
    return null
  }
  throw new Error("Drive shortcut chain exceeds the limit")
}
