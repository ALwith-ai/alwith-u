import type { RootInfo } from "@alwith/module-drive"
import { resolveDriveRoot } from "@alwith/module-drive/content"
import { useDrive } from "@alwith/module-drive/react"
import {
  type DirectoryPickerControls,
  DirectoryPickerDialog,
  type DirectoryPickerRoot,
  type FileTreeController
} from "@alwith/module-file-tree"
import { basename, containsPath, dirname, type FileSystem, normalizePath } from "@alwith/module-fs"
import { type ReactNode, useCallback, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { drive } from "@/features/drive/drive"
import { driveFileSystem } from "@/features/drive/filesystem"

const controls: DirectoryPickerControls = { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Button }
function report(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}

/** Match Desktop's browsable-root policy; selected libraries precede writable cloud-only targets. */
export function pickerRootsOf(roots: readonly RootInfo[], rootPath: string): DirectoryPickerRoot[] {
  const available = roots
    .filter(
      (root) =>
        root.kind !== "SKILL" &&
        root.projectKey !== "ai-session-archive" &&
        root.drivePath.trim() !== "" &&
        (root.selected || root.canWrite)
    )
    .map((root) => ({
      path: normalizePath(root.localPath),
      label: root.name || basename(root.localPath),
      synced: root.selected
    }))
    .toSorted((a, b) => Number(b.synced) - Number(a.synced))
  return available.length > 0 ? available : [{ path: rootPath, label: basename(rootPath) || rootPath, synced: true }]
}

export interface MoveToDialogProps {
  mode?: "move" | "publish"
  sources: readonly string[]
  rootPath: string
  fs: FileSystem
  tree: FileTreeController
  /** The host coordinates cross-workspace/cloud moves and editor mutation guards. */
  onMoveTo: (paths: readonly string[], directory: string) => Promise<boolean>
  onClose: () => void
}

export function MoveToDialog({
  sources,
  rootPath,
  fs,
  tree,
  onMoveTo,
  onClose,
  mode = "move"
}: MoveToDialogProps): ReactNode {
  const publishing = mode === "publish"
  const { t } = useTranslation()
  const { snapshot } = useDrive(drive)
  const roots = snapshot?.roots ?? []
  const pickerRoots = pickerRootsOf(roots, rootPath).filter(
    (candidate) =>
      !publishing ||
      roots.some((root) => normalizePath(root.localPath) === candidate.path && root.canWrite && root.syncEnabled)
  )
  // A confirmed server result belongs to its destination, including across picker refreshes.
  const published = useRef(new Map<string, Set<string>>())
  const cloudCache = useMemo(
    () => ({
      generation: snapshot?.generation,
      folders: new Map<string, Promise<readonly string[]>>()
    }),
    [snapshot?.generation]
  )
  const readChildren = useCallback(
    async (directory: string): Promise<readonly string[]> => {
      const match = resolveDriveRoot(directory, drive.getSnapshot().snapshot?.roots ?? [])
      const cloud = async (): Promise<readonly string[]> => {
        if (!match) return []
        const key = String(match.root.projectId)
        let pending = cloudCache.folders.get(key)
        if (!pending) {
          pending = drive.request({ type: "cloudFolders", projectId: match.root.projectId }).then((response) => {
            if (response.type !== "cloudFolders") throw new Error("Invalid cloud folder response")
            return response.data.map((folder) => normalizePath(`${match.base}/${folder.path}`))
          })
          cloudCache.folders.set(key, pending)
          void pending.catch(() => {
            cloudCache.folders.delete(key)
          })
        }
        return (await pending).filter((path) => dirname(path) === normalizePath(directory))
      }
      const local = async (): Promise<readonly string[]> => {
        const filesystem = containsPath(rootPath, directory) ? fs : await driveFileSystem(directory)
        const entry = await filesystem.stat(directory)
        if (entry === null) return []
        const state = tree.getSnapshot()
        return (
          await filesystem.readDirectory(directory, { showHidden: state.showHidden, showIgnored: state.showIgnored })
        )
          .filter((child) => child.kind === "directory")
          .map((child) => child.path)
      }
      const results = await Promise.allSettled([local(), cloud()])
      const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason as unknown)
      if (errors.length === results.length) throw new AggregateError(errors, "Could not read destination directories")
      for (const error of errors) report(error)
      return [...new Set(results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])))].toSorted()
    },
    [cloudCache, fs, rootPath, tree]
  )
  const warningFor = (directory: string): string | null => {
    if (publishing) return t("workspace.publishWarning")
    const destination = resolveDriveRoot(directory, roots)
    if (!destination) return null
    if (!destination.root.selected) return t("workspace.moveToUnsyncedWarning")
    return sources.some((path) => {
      const source = resolveDriveRoot(path, roots)
      return source !== null && source.root.projectId !== destination.root.projectId
    })
      ? t("workspace.moveCrossProjectWarning")
      : null
  }
  const move = async (directory: string): Promise<boolean> => {
    if (publishing) {
      const destination = normalizePath(directory)
      let completed = published.current.get(destination)
      if (!completed) {
        completed = new Set<string>()
        published.current.set(destination, completed)
      }
      try {
        for (const source of sources) {
          if (completed.has(source)) continue
          const entry = await fs.stat(source)
          if (entry === null || entry === undefined) throw new Error(t("workspace.publishSourceMissing"))
          const response = await drive.request({
            type: "publishBetweenProjects",
            source: source.replace(/\.yupcloud$/, ""),
            destination: directory,
            isDirectory: entry.kind === "directory"
          })
          if (response.type !== "id") throw new Error("Invalid Drive publish response")
          if (response.data === null) throw new Error(t("workspace.publishNotUploaded"))
          completed.add(source)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          completed.size > 0 ? t("workspace.publishPartialFailure", { count: completed.size, message }) : message,
          { cause: error }
        )
      }
      toast.success(t("workspace.publishDone", { count: completed.size }))
      return true
    }
    const currentRoots = drive.getSnapshot().snapshot?.roots ?? []
    const destination = resolveDriveRoot(directory, currentRoots)
    const sameProject = sources.every(
      (path) => resolveDriveRoot(path, currentRoots)?.root.projectId === destination?.root.projectId
    )
    if (sameProject && containsPath(rootPath, directory) && (await fs.stat(directory))?.kind === "directory") {
      await tree.move(sources, directory)
      return true
    }
    return onMoveTo(sources, directory)
  }
  return (
    <DirectoryPickerDialog
      key={cloudCache.generation ?? "local"}
      controls={controls}
      roots={pickerRoots}
      hiddenPaths={sources}
      readChildren={readChildren}
      warningFor={warningFor}
      onConfirm={move}
      onClose={onClose}
      onError={report}
      labels={{
        title: t(publishing ? "workspace.publishDialogTitle" : "workspace.moveDialogTitle", { count: sources.length }),
        confirm: t(publishing ? "workspace.publish" : "workspace.move"),
        cancel: t("workspace.cancel"),
        notSynced: t("workspace.moveTargetNotSynced"),
        expand: t("workspace.expandFolder"),
        collapse: t("workspace.collapseFolder"),
        loading: t("workspace.loading")
      }}
    />
  )
}
