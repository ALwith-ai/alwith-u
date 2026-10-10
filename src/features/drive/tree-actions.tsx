import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ContextMenuItem } from "@/components/ui/context-menu"
import {
  driveFileDeepLink,
  driveFileWebUrl,
  resolveCondenseScope,
  resolveDriveRoot,
  type CondenseScope
} from "@alwith/module-drive/content"
import { togglePinned, isPinned, useDrive } from "@alwith/module-drive/react"
import { drive } from "./controller"
import { driveFileSystem } from "./filesystem"
import { saveDrivePins, useDrivePins } from "./pinned"

export function DriveTreeActions({
  path,
  isDirectory,
  onSharing,
  onCondense,
  onMove,
  saveDocument
}: {
  path: string
  isDirectory: boolean
  onSharing(path: string): void
  onCondense(scope: CondenseScope): void
  onMove(path: string, kind: "file" | "directory"): void
  saveDocument(path: string): Promise<void>
}): ReactNode {
  const { snapshot } = useDrive(drive)
  const { i18n } = useTranslation()
  const label = (en: string, zh: string): string => (i18n.language.startsWith("zh") ? zh : en)
  const profile = `${snapshot?.baseUrl ?? ""}|${snapshot?.localRoot ?? ""}`
  const pins = useDrivePins(profile)
  const match = resolveDriveRoot(path, snapshot?.roots ?? [])
  const scope = resolveCondenseScope(path, snapshot?.roots ?? [])
  if (!snapshot?.running || !match || !scope) return null
  const realPath = path.replace(/\.yupcloud$/, "")
  const run = (action: () => Promise<void>): void => {
    void action().catch(error => toast.error(String(error)))
  }
  const link = async (desktop: boolean): Promise<void> => {
    const response = await drive.request({ type: "fileRemoteId", path: realPath })
    if (response.type !== "id" || response.data === null)
      throw new Error(label("Upload this file before sharing a link", "请先上传文件再复制链接"))
    if (desktop) {
      await navigator.clipboard.writeText(driveFileDeepLink(response.data).replace(/^alwith:/, "alwith-u:"))
      return
    }
    if (!snapshot.webBaseUrl) throw new Error("Drive web address is unavailable")
    await navigator.clipboard.writeText(driveFileWebUrl(snapshot.webBaseUrl, response.data))
  }
  return (
    <>
      <ContextMenuItem onClick={() => onSharing(realPath)}>
        {label("Sharing and permissions", "共享与权限")}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onCondense(scope)}>
        {label("Condense into knowledge", "沉淀为知识")}
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() =>
          run(async () => {
            const stat = await (await driveFileSystem(path)).stat(path)
            if (!stat) throw new Error("The selected Drive entry no longer exists")
            saveDrivePins(
              profile,
              togglePinned(pins, {
                path: realPath,
                name: realPath.slice(realPath.lastIndexOf("/") + 1),
                kind: stat.kind === "directory" ? "dir" : "file"
              })
            )
          })
        }>
        {label(isPinned(pins, realPath) ? "Unpin" : "Pin", isPinned(pins, realPath) ? "取消固定" : "固定")}
      </ContextMenuItem>
      {!isDirectory && (
        <>
          <ContextMenuItem onClick={() => run(() => link(false))}>
            {label("Copy web link", "复制网页链接")}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => run(() => link(true))}>
            {label("Copy desktop link", "复制桌面链接")}
          </ContextMenuItem>
        </>
      )}
      {!isDirectory && !path.endsWith(".yupcloud") && match.root.canWrite && (
        <ContextMenuItem
          onClick={() =>
            run(async () => {
              await saveDocument(realPath)
              const response = await drive.request({ type: "saveVersion", path: realPath })
              if (response.type !== "id") throw new Error("Invalid Drive version response")
              if (response.data === null) throw new Error(label("This file is not in Drive", "此文件尚未进入云盘"))
              toast.success(label("Version saved", "版本已保存"))
            })
          }>
          {label("Save version now", "立即保存版本")}
        </ContextMenuItem>
      )}
      {match.root.canWrite && scope.scopePath !== null && (
        <ContextMenuItem
          onClick={() =>
            run(async () => {
              const stat = await (await driveFileSystem(path)).stat(path)
              if (!stat) throw new Error("The selected Drive entry no longer exists")
              onMove(path, stat.kind === "directory" ? "directory" : "file")
            })
          }>
          {label("Move to another project…", "移动到其他项目…")}
        </ContextMenuItem>
      )}
    </>
  )
}
