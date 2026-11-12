import {
  CommentSurface,
  type DriveContentHost,
  DriveContentProvider,
  driveContentTranslator
} from "@alwith/module-drive/content"
import { useDriveSelector } from "@alwith/module-drive/react"
import { containsPath } from "@alwith/module-fs"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { shallow } from "zustand/shallow"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

import { setCollaborationOwner } from "./collaboration-owners"
import { drive, driveTransport } from "./controller"

export function useDriveContentHost(saveDocument: (path: string) => Promise<void>): DriveContentHost {
  const { i18n } = useTranslation()
  const { connected, configured, generation, pushConnected } = useDriveSelector(
    drive,
    ({ connected, snapshot }) => ({
      connected,
      configured: snapshot?.configured,
      generation: snapshot?.generation,
      pushConnected: snapshot?.status?.pushConnected ?? false
    }),
    shallow
  )
  const [userName, setUserName] = useState("")
  useEffect(() => {
    let active = true
    if (!connected || !configured) {
      setUserName("")
      return
    }
    void drive
      .request({ type: "configuration" })
      .then((response) => {
        if (response.type !== "configuration") throw new Error("Invalid Drive configuration")
        if (active) setUserName(response.data.userName ?? "")
      })
      .catch((error: unknown) => {
        if (active) toast.error(String(error))
      })
    return () => {
      active = false
    }
  }, [connected, configured, generation])
  return useMemo(
    () => ({
      transport: driveTransport,
      generation,
      collaborationOwner: setCollaborationOwner,
      saveDocument,
      userName,
      language: i18n.language,
      pushConnected,
      translate: driveContentTranslator(i18n.language.startsWith("zh") ? "zh-CN" : "en"),
      onError: (error) => toast.error(String(error)),
      notify: toast,
      searchUsers: async (keyword) => {
        const response = await drive.request({ type: "searchUsers", query: keyword })
        if (response.type !== "users") throw new Error("Invalid Drive user search")
        return response.data
      },
      controls: {
        Button,
        Input,
        Textarea,
        Checkbox: ({ checked, onCheckedChange }) => (
          <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value)} />
        )
      }
    }),
    [userName, i18n.language, pushConnected, generation, saveDocument]
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
  const managed = useDriveSelector(drive, ({ snapshot }) =>
    Boolean(
      path !== null &&
      snapshot?.running &&
      snapshot.roots.some((root) => root.drivePath && containsPath(root.localPath, path))
    )
  )
  return (
    <DriveContentProvider host={host}>
      {managed && path !== null ? (
        <CommentSurface key={path} path={path}>
          {children}
        </CommentSurface>
      ) : (
        children
      )}
    </DriveContentProvider>
  )
}
