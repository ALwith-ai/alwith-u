import { containsPath, createFileSystem, type FileSystem } from "@alwith/module-fs"
import { createTauriAdapter } from "@alwith/module-fs/tauri"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { drive } from "./controller"

/** Authorize only paths belonging to indexed Drive projects, including launcher searches. */
export async function driveFileSystem(path: string): Promise<FileSystem> {
  const snapshot = drive.getSnapshot().snapshot
  const root = snapshot?.roots
    .filter(root => root.drivePath && containsPath(root.localPath, path))
    .sort((a, b) => b.localPath.length - a.localPath.length)[0]
  if (!root) throw new Error("This path does not belong to an indexed Drive project")
  const authorized = await invoke<string>("workspace_open", { path: root.localPath })
  return createFileSystem({
    adapter: createTauriAdapter({
      root: authorized,
      transport: { invoke: request => invoke("workspace_file", { request }) }
    }),
    reportError: error => toast.error(String(error))
  })
}
