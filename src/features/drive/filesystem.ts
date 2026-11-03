import { containsPath, createFileSystem, type FileSystem } from "@alwith/module-fs"
import { commands as fs } from "@alwith/module-fs/commands"
import { createTauriAdapter } from "@alwith/module-fs/tauri"
import { toast } from "sonner"

import { commands } from "@/bindings"
import { text } from "@/lib/text"

import { drive } from "./controller"

/** Authorize only paths belonging to indexed Drive projects, including launcher searches. */
export async function driveFileSystem(path: string): Promise<FileSystem> {
  const snapshot = drive.getSnapshot().snapshot
  const root = snapshot?.roots
    .filter((root) => root.drivePath && containsPath(root.localPath, path))
    .toSorted((a, b) => b.localPath.length - a.localPath.length)[0]
  if (!root) throw new Error("This path does not belong to an indexed Drive project")
  const authorized = await fs.workspaceOpen({ path: root.localPath })
  return createFileSystem({
    adapter: createTauriAdapter({ root: authorized, watch: false }),
    reportError: (error) => toast.error(text(error))
  })
}

/** Check indexed cloud paths without opening a workspace that may not exist yet. */
export async function drivePathExists(path: string): Promise<boolean> {
  return commands.drivePathExists({ path })
}
