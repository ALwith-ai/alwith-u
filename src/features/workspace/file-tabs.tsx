import { FileTabs as SharedFileTabs, type FileTabsProps } from "@alwith/module-editor/tabs"
import { useContext } from "react"
import { createPortal } from "react-dom"

import { displayShortcut } from "@/lib/shortcut-formatter"

import { WorkspaceTabHostContext } from "./workspace-tab-host-context"
import "@alwith/module-tabs/styles.css"

export function FileTabs(props: FileTabsProps) {
  const host = useContext(WorkspaceTabHostContext)
  const tabs = <SharedFileTabs {...props} newTabShortcutLabel={displayShortcut("CmdOrCtrl+T")} />
  return host ? createPortal(tabs, host) : tabs
}
