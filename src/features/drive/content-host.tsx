import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useDrive } from "@alwith/module-drive/react"
import {
  CommentSurface,
  DriveContentProvider,
  driveContentTranslator,
  type DriveContentHost
} from "@alwith/module-drive/content"
import { containsPath } from "@alwith/module-fs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { setCollaborationOwner } from "./collaboration-owners"
import { drive, driveTransport } from "./controller"

export function useDriveContentHost(saveDocument: (path: string) => Promise<void>): DriveContentHost {
  const { i18n } = useTranslation()
  const { snapshot } = useDrive(drive)
  const [userName, setUserName] = useState("")
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload account-scoped data after native generation changes.
  useEffect(() => {
    let active = true
    if (!snapshot?.configured) {
      setUserName("")
      return
    }
    void drive
      .request({ type: "configuration" })
      .then(response => {
        if (response.type !== "configuration") throw new Error("Invalid Drive configuration")
        if (active) setUserName(response.data.userName ?? "")
      })
      .catch((error: unknown) => {
        if (active) toast.error(String(error))
      })
    return () => {
      active = false
    }
  }, [snapshot?.configured, snapshot?.generation])
  return useMemo(
    () => ({
      transport: driveTransport,
      generation: snapshot?.generation,
      collaborationOwner: setCollaborationOwner,
      saveDocument,
      userName,
      language: i18n.language,
      pushConnected: snapshot?.status?.pushConnected ?? false,
      translate: driveContentTranslator(i18n.language.startsWith("zh") ? "zh-CN" : "en"),
      onError: error => toast.error(String(error)),
      notify: toast,
      searchUsers: async keyword => {
        const response = await drive.request({ type: "searchUsers", query: keyword })
        if (response.type !== "users") throw new Error("Invalid Drive user search")
        return response.data
      },
      controls: {
        Button,
        Input,
        Textarea,
        Checkbox: ({ checked, onCheckedChange }) => (
          <Checkbox checked={checked} onCheckedChange={value => onCheckedChange(value)} />
        )
      }
    }),
    [userName, i18n.language, snapshot?.status?.pushConnected, snapshot?.generation, saveDocument]
  )
}
export function DriveDocumentSurface({
  host,
  path,
  children
}: {
  host: DriveContentHost
  path: string | null
  children: ReactNode
}): ReactNode {
  const { snapshot } = useDrive(drive)
  const managed =
    path !== null &&
    snapshot?.running &&
    snapshot.roots.some(root => root.drivePath && containsPath(root.localPath, path))
  return (
    <DriveContentProvider host={host}>
      {managed ? (
        <CommentSurface key={path} path={path}>
          {children}
        </CommentSurface>
      ) : (
        children
      )}
    </DriveContentProvider>
  )
}
