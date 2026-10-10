import { drive } from "./controller"
export { drive } from "./controller"
import type { FailedUpload, RootInfo } from "@alwith/module-drive"
import {
  DriveMassDeleteDialog,
  DrivePanel,
  DriveSharing,
  useDrive,
  driveTranslator,
  summarize,
  type DriveHost
} from "@alwith/module-drive/react"
import "@alwith/module-drive/styles.css"
import { isTauri } from "@tauri-apps/api/core"
import { confirm, open } from "@tauri-apps/plugin-dialog"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import { containsPath } from "@alwith/module-fs"
import { DriveCondense, type CondenseScope } from "@alwith/module-drive/content"
import { revealItemsInDir } from "@tauri-apps/plugin-opener"
import { openExternal } from "@/lib/open"
import { driveControls } from "./controls"
import { driveFileSystem, drivePathExists } from "./filesystem"
import { saveDrivePins, useDrivePins } from "./pinned"
import { DriveIntegrations } from "./integrations"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useDriveVisible } from "./use-drive-visible"
import { CloudIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { openSettingsWindow } from "@/lib/window-manager"
import { useWorkspace } from "@/features/workspace/context"

export function useDriveConnection(start = true): void {
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    void drive
      .attach()
      .then(async () => {
        if (start && !disposed && drive.getSnapshot().snapshot?.configured) {
          await drive.request({ type: "start" })
          await drive.request({ type: "refreshClientConfig" })
        }
      })
      .catch((error: unknown) => {
        if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
      drive.dispose()
    }
  }, [start])
}

export function DrivePage({
  onOpenProject,
  currentProject
}: {
  currentProject?: string | null
  onOpenProject: (root: RootInfo) => Promise<void>
}): ReactNode {
  const workspace = useWorkspace()
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en"
  const { snapshot } = useDrive(drive)
  const profile = `${snapshot?.baseUrl ?? ""}|${snapshot?.localRoot ?? ""}`
  const pins = useDrivePins(profile)
  const [condense, setCondense] = useState<CondenseScope | null>(null)
  const openProject = async (root: RootInfo): Promise<void> => {
    if (!workspace) throw new Error("Drive requires a workspace host")
    await onOpenProject(root)
    await workspace.openProject(root.localPath)
  }
  const host: DriveHost = {
    readDirectory: async path =>
      (await (await driveFileSystem(path)).readDirectory(path)).map(entry => ({
        name: entry.name,
        isDirectory: entry.kind === "directory"
      })),
    pathExists: drivePathExists,
    onOpenEntry: async entry => {
      if (!workspace) throw new Error("Drive requires a workspace host")
      const root = drive
        .getSnapshot()
        .snapshot?.roots.filter(root => root.drivePath && containsPath(root.localPath, entry.path))
        .sort((a, b) => b.localPath.length - a.localPath.length)[0]
      if (!root) throw new Error("Drive project is unavailable")
      await openProject(root)
      if (entry.isDirectory) await workspace.revealEntry(entry.path, root.localPath)
      else await workspace.openFile(entry.path, root.localPath)
    },
    onRevealPath: path => revealItemsInDir(path),
    onOpenExternal: openExternal,
    pinnedDocs: pins,
    onPinnedDocsChange: async docs => {
      saveDrivePins(profile, docs)
    },
    onCondense: async root => {
      setCondense({ projectId: root.projectId, projectName: root.name, scopePath: null })
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <DrivePanel
        controller={drive}
        mode="launcher"
        currentProject={currentProject ?? undefined}
        locale={locale}
        host={host}
        controls={driveControls}
        onOpenSettings={openDriveSettings}
        onOpenProject={openProject}
        confirm={message => confirm(message, { title: "YUP Drive", kind: "warning" })}
      />
      <Dialog
        open={condense !== null}
        onOpenChange={open => {
          if (!open) setCondense(null)
        }}>
        <DialogContent className="max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{driveTranslator(locale)("condense.action")}</DialogTitle>
          </DialogHeader>
          {condense && (
            <DriveCondense
              controller={drive}
              scope={condense}
              controls={driveControls}
              locale={locale}
              onClose={() => setCondense(null)}
              onOpenFile={path => host.onOpenEntry({ path, isDirectory: false })}
              onOpenExternal={openExternal}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function DriveSharingDialog({ path, onClose }: { path: string | null; onClose: () => void }): ReactNode {
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en"
  const t = driveTranslator(locale)
  return (
    <Dialog
      open={path !== null}
      onOpenChange={open => {
        if (!open) onClose()
      }}>
      <DialogContent className="max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{t("grants.title")}</DialogTitle>
          <DialogDescription>{path}</DialogDescription>
        </DialogHeader>
        {path && (
          <DriveSharing
            key={path}
            controller={drive}
            path={path}
            locale={locale}
            host={{
              readDirectory: async value =>
                (await (await driveFileSystem(value)).readDirectory(value)).map(entry => ({
                  name: entry.name,
                  isDirectory: entry.kind === "directory"
                })),
              pathExists: drivePathExists,
              onOpenEntry: async () => {
                throw new Error("Navigation is unavailable in this permissions dialog")
              },
              onRevealPath: revealItemsInDir,
              onOpenExternal: openExternal,
              pinnedDocs: [],
              onPinnedDocsChange: async () => {
                throw new Error("Pins are unavailable in this permissions dialog")
              }
            }}
            controls={driveControls}
            confirm={message => confirm(message, { title: "Drive sharing", kind: "warning" })}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function openDriveSettings(): void {
  void openSettingsWindow("drive").catch((error: unknown) => toast.error(String(error)))
}

export function DriveSettings(): ReactNode {
  useDriveConnection(false)
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en"
  const host = useMemo<DriveHost>(
    () => ({
      readDirectory: async () => {
        throw new Error("Project browsing belongs to the main window")
      },
      pathExists: async () => {
        throw new Error("Project browsing belongs to the main window")
      },
      onOpenEntry: async () => {
        throw new Error("Project browsing belongs to the main window")
      },
      onRevealPath: path => revealItemsInDir(path),
      onOpenExternal: openExternal,
      pinnedDocs: [],
      onPinnedDocsChange: async () => {
        throw new Error("Pinned documents belong to the main window")
      },
      integrations: <DriveIntegrations />
    }),
    []
  )
  return (
    <DrivePanel
      controller={drive}
      mode="settings"
      locale={locale}
      host={host}
      controls={driveControls}
      defaultBaseUrl="https://yup-knowledge-server.finture.id/yup-knowledge"
      onOpenProject={async () => {
        throw new Error("Project navigation belongs to the main window")
      }}
      chooseDirectory={async () => {
        const path = await open({ directory: true, multiple: false })
        return typeof path === "string" ? path : null
      }}
      confirm={message => confirm(message, { title: "Drive", kind: "warning" })}
    />
  )
}

export function DriveStatus(): ReactNode {
  const visible = useDriveVisible()
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en"
  const t = driveTranslator(locale)
  const { connected, snapshot } = useDrive(drive)
  const [failures, setFailures] = useState<FailedUpload[]>([])
  useEffect(() => {
    let active = true
    if (!connected || !snapshot?.running || !snapshot.status?.failed) {
      setFailures([])
      return
    }
    void drive
      .request({ type: "failedUploads" })
      .then(response => {
        if (response.type !== "failedUploads") throw new Error("Invalid Drive failed transfer response")
        if (active) setFailures(response.data)
      })
      .catch((error: unknown) => {
        if (active) toast.error(String(error))
      })
    return () => {
      active = false
    }
  }, [connected, snapshot?.running, snapshot?.status])
  if (!visible || !snapshot?.configured) return null
  const summary = summarize(snapshot.status, failures)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="pointer-events-auto h-6 text-xs" aria-label={t("title")}>
            <CloudIcon />
            {t(summary.key, { count: summary.count })}
          </Button>
        }
      />
      <PopoverContent side="top" className="max-h-[70vh] w-96 overflow-auto">
        <DrivePanel
          controller={drive}
          mode="status"
          locale={locale}
          controls={driveControls}
          onOpenSettings={openDriveSettings}
          host={{
            readDirectory: async () => {
              throw new Error("Project browsing belongs to the launcher")
            },
            pathExists: async () => {
              throw new Error("Project browsing belongs to the launcher")
            },
            onOpenEntry: async () => {
              throw new Error("Project navigation belongs to the launcher")
            },
            onRevealPath: path => revealItemsInDir(path),
            onOpenExternal: openExternal,
            pinnedDocs: [],
            onPinnedDocsChange: async () => {
              throw new Error("Pinned documents belong to the launcher")
            }
          }}
          onOpenProject={async () => {
            throw new Error("Projects cannot be opened from sync status")
          }}
          confirm={message => confirm(message, { title: "YUP Drive", kind: "warning" })}
        />
      </PopoverContent>
    </Popover>
  )
}

export function DriveDeleteConfirmation(): ReactNode {
  const { i18n } = useTranslation()
  return (
    <DriveMassDeleteDialog
      controller={drive}
      controls={driveControls}
      locale={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
    />
  )
}
