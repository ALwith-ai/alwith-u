import { driveFileIndex, type Job, type RemoteId } from "@alwith/module-drive"
import {
  ChatCondenseEntry,
  type CondenseScope,
  DriveCondense,
  DriveMoveDialog,
  resolveDriveRoot
} from "@alwith/module-drive/content"
import { DriveBadge, useDriveSelector } from "@alwith/module-drive/react"
import {
  type CloseDecision,
  createEditorController,
  type EditorController,
  type EditorLabels,
  ImagePreview
} from "@alwith/module-editor"
import {
  createFileTreeController,
  FileTree,
  type FileTreeController,
  type FileTreeLabels
} from "@alwith/module-file-tree"
import {
  containsPath,
  createFileSystem,
  dirname,
  type FileSystem,
  type FsTransaction,
  normalizePath
} from "@alwith/module-fs"
import { commands as fsCommands } from "@alwith/module-fs/commands"
import { createTauriAdapter } from "@alwith/module-fs/tauri"
import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { confirm } from "@tauri-apps/plugin-dialog"
import { Effect } from "effect"

import { ContextMenuItem } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { type FolderChatTarget, sameChatDirectory } from "@/features/chat/folder-chat"
import { focusDeviceWindow, useDeviceWindowReturn } from "@/features/device/window-routing"
import { collaborationOwner, useCollaborationOwner } from "@/features/drive/collaboration-owners"
import { DriveDocumentSurface, useDriveContentHost } from "@/features/drive/content-host"
import { driveControls, driveDialogClassName } from "@/features/drive/controls"
import { useDriveDeepLinks } from "@/features/drive/deep-links"
import { drive, DriveSharingDialog } from "@/features/drive/drive"
import { isPdfPreview, maxEditorBytes, prepareWorkspaceFile } from "@/features/drive/files"
import { driveFileSystem } from "@/features/drive/filesystem"
import { rebaseDrivePins } from "@/features/drive/pinned"
import { DriveTreeActions } from "@/features/drive/tree-actions"
import { client } from "@/lib/client"
import { openExternal, openExternalEntry, openHtmlInBrowser, openLocalPath, revealInFileManager } from "@/lib/open"
import { isMac } from "@/lib/platform"
import "@alwith/module-file-tree/styles.css"
import "@alwith/module-editor/styles.css"
import { DesktopCanvasContext as CanvasContext } from "@alwith/module-desktop-shell/react"
import { createFileTabs, type FileTabsController } from "@alwith/module-editor/tabs/core"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { BoardMenuItem, BoardPane } from "@/features/board/board-pane"
import { ChatDirectoryContext, ChatOpenWebLinkContext } from "@/features/chat/file-actions"
import { DeviceWorkspaceMenu, DeviceWorkspacePane } from "@/features/device/device-workspace"
import { useDeviceReveal } from "@/features/device/use-device-reveal"
import { BackgroundWorkspacePane } from "@/features/terminal/background-workspace"
import {
  TerminalWorkspaceMenuItem,
  TerminalWorkspacePane,
  useTerminalViewAvailable
} from "@/features/terminal/terminal-workspace"

import {
  type FilePosition,
  WorkspaceBrowserEntryContext,
  WorkspaceContext,
  type WorkspaceFileReference,
  WorkspaceHeaderContext,
  type WorkspacePane,
  WorkspaceSessionContext
} from "./context"
import { connectExplorerSettings } from "./explorer-settings"
import { useHostDialog } from "./host-dialog"
import type { PanelControls } from "./panel-controls-context"
import { PreviewPaneContext } from "./preview-pane-context"
import { PreviewSurface } from "./preview-surface"
import { WorkspaceButton } from "./workspace-button"
import { WorkspaceEditor } from "./workspace-editor"
import { WorkspacePanels } from "./workspace-panels"
import "./workspace.css"
import { routeHistory, routeReplace } from "./editor-shortcuts"
import { createHtmlPreviewHost } from "./html-preview"
import { localPreviewProviders } from "./local-previews"
import { MoveToDialog } from "./move-to-dialog"
import { moveWorkspaceFiles, type WorkspaceMoveOutcome } from "./move-workspace-files"
import { resolvePreviewResource } from "./preview-resources"
import { createTreeOpener } from "./tree-opener"
import { useEditorPreferences } from "./use-editor-preferences"
import { openWorkspaceScope, workspaceTask } from "./workspace-lifecycle"
import { createWorkspaceStateStore, type IconTheme, type WorkspaceState } from "./workspace-state"
import "@alwith/module-editor/previews/styles.css"

const loadMonaco = () => import("./monaco-editor")
const CodeEditor = lazy(loadMonaco)
interface Workspace {
  root: string
  fs: FileSystem
  tree: FileTreeController
  editor: EditorController
  tabs: FileTabsController
  treeOpener: ReturnType<typeof createTreeOpener>
  iconTheme: IconTheme
}
type PreviewFiles = Pick<Workspace, "root" | "fs">
const emptyEditorSnapshot = (): null => null
const noEditorSubscription = (): (() => void) => () => {}
function report(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}
export function FileWorkspace({
  cwd,
  children,
  chatRevealRequest = 0,
  onChatInFolder,
  revealFolder
}: {
  cwd: string | null
  children: ReactNode
  chatRevealRequest?: number
  onChatInFolder?: (target: FolderChatTarget) => void
  revealFolder?: FolderChatTarget | null
}) {
  const fileReference = useRef<WorkspaceFileReference | null>(null)
  const registerFileReference = useCallback((target: WorkspaceFileReference) => {
    if (fileReference.current !== null) throw new Error("The workspace already has a composer")
    fileReference.current = target
    return () => {
      if (fileReference.current === target) fileReference.current = null
    }
  }, [])
  const { resolvedTheme } = useTheme()
  const openChatWeb = useContext(ChatOpenWebLinkContext)
  const registerOpenChatFile = useContext(PreviewPaneContext)?.registerOpenChatFile
  const { t, i18n } = useTranslation(),
    { ask, dialog } = useHostDialog()
  const workspaces = useRef(new Map<string, Workspace>()),
    opening = useRef(new Map<string, Promise<Workspace>>())
  const outsideFiles = useRef(new Map<string, Promise<PreviewFiles>>())
  const previewFiles = useCallback((workspace: PreviewFiles | null, path: string): Promise<PreviewFiles> => {
    if (workspace && containsPath(workspace.root, path)) return Promise.resolve(workspace)
    const directory = dirname(path)
    const existing = outsideFiles.current.get(directory)
    if (existing) return existing
    const opened = fsCommands.workspaceOpen({ path: directory }).then((root) => ({
      root,
      fs: createFileSystem({ adapter: createTauriAdapter({ root, watch: false }), reportError: report })
    }))
    outsideFiles.current.set(directory, opened)
    void opened.catch(() => outsideFiles.current.delete(directory))
    return opened
  }, [])
  const saveDriveDocument = useCallback(async (path: string): Promise<void> => {
    for (const owner of workspaces.current.values()) {
      const document = owner.editor.getSnapshot().documents.find((document) => document.path === path)
      if (document) {
        await owner.editor.save(document.id)
        return
      }
    }
    // Closed files already have their latest contents on disk.
  }, [])
  const contentHost = useDriveContentHost(saveDriveDocument)
  const routeDriveTarget = useRef<(path: string) => Promise<void>>(() => {
    return Promise.try(() => {
      throw new Error("Workspace navigation is not ready")
    })
  })
  const lifecycle = useRef(new AbortController())
  const stateStore = useMemo(() => createWorkspaceStateStore(), [])
  const { settings, iconTheme } = useEditorPreferences()
  const [sharingPath, setSharingPath] = useState<string | null>(null)
  const [condenseJob, setCondenseJob] = useState<Job | undefined>()
  const [condenseScope, setCondenseScope] = useState<CondenseScope | null>(null)
  const [moveTarget, setMoveTarget] = useState<{ path: string; kind: "file" | "directory" } | null>(null)
  const [publishSources, setPublishSources] = useState<{ owner: Workspace; paths: readonly string[] } | null>(null)
  const [moveSources, setMoveSources] = useState<{ owner: Workspace; paths: readonly string[] } | null>(null)
  const condenseHost = useMemo(
    () => ({
      readSnooze: (id: RemoteId): Promise<number | null> => {
        return Promise.try(() => {
          const profile = drive.getSnapshot().snapshot
          const raw = localStorage.getItem(
            `alwith:drive:condense-snooze:${profile?.baseUrl}:${profile?.localRoot}:${id}`
          )
          if (raw === null) return null
          const value = Number(raw)
          if (!Number.isFinite(value)) throw new Error("Invalid Drive suggestion preference")
          return value
        })
      },
      writeSnooze: (id: RemoteId, until: number): Promise<void> => {
        return Promise.try(() => {
          const profile = drive.getSnapshot().snapshot
          localStorage.setItem(
            `alwith:drive:condense-snooze:${profile?.baseUrl}:${profile?.localRoot}:${id}`,
            String(until)
          )
        })
      }
    }),
    []
  )
  const panelControls = useRef<PanelControls | null>(null)
  const headerTarget = useContext(WorkspaceHeaderContext)
  const browserEntry = useContext(WorkspaceBrowserEntryContext)
  const [visible, setVisible] = useState(false),
    [treeVisible, setTreeVisible] = useState(true),
    [viewMode, setViewMode] = useState(false),
    [pane, setPane] = useState<WorkspacePane>("files"),
    // The canvas file the board pane shows; undefined is the project's own board.
    [boardFile, setBoardFile] = useState<string>()
  /** A canvas file of the open project opens as its board, not as text. */
  const openBoard = (path: string): boolean => {
    const project = currentCwd.current
    if (!/\.canvas$/i.test(path) || project === null || !containsPath(project, path)) return false
    setBoardFile(normalizePath(path).slice(normalizePath(project).length + 1))
    setPane("board")
    setVisible(true)
    return true
  }
  const openBoardRef = useRef(openBoard)
  openBoardRef.current = openBoard
  const terminalAvailable = useTerminalViewAvailable()
  const paneSessionId = useContext(WorkspaceSessionContext)
  const currentPaneSession = useRef(paneSessionId)
  currentPaneSession.current = paneSessionId
  const canvas = useContext(CanvasContext)
  const navigateCanvas = canvas?.navigate
  const previousChatRevealRequest = useRef(chatRevealRequest)
  useEffect(() => {
    if (previousChatRevealRequest.current === chatRevealRequest) return
    previousChatRevealRequest.current = chatRevealRequest
    // New and returned chats must be visible even when the chat pane was collapsed.
    setViewMode(false)
    navigateCanvas?.("chat")
  }, [chatRevealRequest, navigateCanvas])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [navigation, setNavigation] = useState<{ path: string; position: FilePosition } | null>(null)
  const editorSnapshot = useSyncExternalStore(
    workspace ? workspace.editor.subscribe : noEditorSubscription,
    workspace ? workspace.editor.getSnapshot : emptyEditorSnapshot
  )
  const tabSnapshot = useSyncExternalStore(
    workspace ? workspace.tabs.subscribe : noEditorSubscription,
    workspace ? workspace.tabs.getSnapshot : emptyEditorSnapshot
  )
  const activeDocument = editorSnapshot?.documents.find((document) => document.id === tabSnapshot?.activeId)
  const statPreviewFile = useCallback(
    async (path: string) => (await previewFiles(workspace, path)).fs.stat(path),
    [previewFiles, workspace]
  )
  const activeCollaborationOwner = useCollaborationOwner(activeDocument?.path)
  const driveState = useDriveSelector(
    drive,
    (state) => state.snapshot,
    (left, right) => left?.roots === right?.roots && left?.running === right?.running
  )
  const driveSourceReadOnly = useDriveSelector(drive, ({ snapshot }) =>
    Boolean(activeDocument && driveFileIndex(snapshot).files.get(activeDocument.path)?.state === "collab")
  )
  const driveReadOnly = useDriveSelector(drive, ({ snapshot }) => {
    if (!activeDocument || !snapshot) return false
    const root = snapshot.roots.find((root) => containsPath(root.localPath, activeDocument.path))
    const file = driveFileIndex(snapshot).files.get(activeDocument.path.replaceAll("\\", "/"))
    return Boolean(
      (root && (!snapshot.running || !root.canWrite || !root.syncEnabled || root.cloudOnly || root.kind === "SKILL")) ||
      file?.state === "readOnly"
    )
  })
  useEffect(() => {
    for (const owner of workspaces.current.values()) owner.tree.setActive(owner === workspace)
  }, [workspace])
  const previews = useMemo(() => {
    if (!workspace) return []
    const imageLabels = {
      failed: t("workspace.imageFailed"),
      zoomIn: t("workspace.zoomIn"),
      zoomOut: t("workspace.zoomOut"),
      resetZoom: t("workspace.resetZoom")
    }
    return [
      {
        id: "image",
        supports: (document: import("@alwith/module-editor").EditorDocument) =>
          /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i.test(document.path),
        render: (document: import("@alwith/module-editor").EditorDocument) => (
          <ImagePreview document={document} labels={imageLabels} onError={report} />
        )
      },
      ...localPreviewProviders(
        {
          htmlPreview: {
            open: async (path, source) => {
              const { root, fs } = await previewFiles(workspace, path)
              return createHtmlPreviewHost(root, fs, invoke).open(path, source)
            },
            subscribe: async (path, onChange, onError) => {
              const { root, fs } = await previewFiles(workspace, path)
              return createHtmlPreviewHost(root, fs, invoke).subscribe(path, onChange, onError)
            }
          },
          openLink: openExternal,
          resolveResource: async (path, reference) => {
            const { root, fs } = await previewFiles(workspace, path)
            return resolvePreviewResource(fs, root, path, reference)
          },
          openExternal,
          allowRemoteResources: true,
          autoSaveDelay: 800,
          imageLabels,
          labels: {
            loading: t("workspace.previewsLoading"),
            openExternal: t("workspace.openExternal"),
            legacyWord: t("workspace.legacyWord"),
            mediaUnsupported: t("workspace.mediaUnsupported"),
            emptySheet: t("workspace.emptySheet"),
            worksheets: t("workspace.worksheets"),
            bold: t("workspace.bold"),
            italic: t("workspace.italic"),
            outline: t("workspace.outline"),
            outlineEmpty: t("workspace.outlineEmpty"),
            editMarkdown: t("workspace.editMarkdown"),
            copyCode: t("workspace.copyCode"),
            toggleWrap: t("workspace.toggleWrap"),
            previousSheet: t("workspace.previousSheet"),
            nextSheet: t("workspace.nextSheet"),
            page: t("workspace.page"),
            thumbnails: t("workspace.thumbnails"),
            zoomIn: t("workspace.zoomIn"),
            zoomOut: t("workspace.zoomOut"),
            resetZoom: t("workspace.resetZoom")
          }
        },
        contentHost
      )
    ]
  }, [workspace, t, contentHost, previewFiles])
  const reportedDirty = useRef(false)
  const requestGeneration = useRef(0),
    currentCwd = useRef(cwd)
  currentCwd.current = cwd
  useEffect(() => {
    if (!isTauri()) return
    const window = getCurrentWindow()
    const subscriptions = [
      window.listen("menu:replace-in-file", routeReplace),
      window.listen("menu:edit-undo", () => routeHistory("undo")),
      window.listen("menu:edit-redo", () => routeHistory("redo"))
    ]
    return () => {
      for (const subscription of subscriptions) void subscription.then((stop) => stop()).catch(report)
    }
  }, [])
  const ensure = useCallback(
    async (directory: string | null): Promise<Workspace> => {
      const signal = lifecycle.current.signal
      signal.throwIfAborted()
      const requested =
        directory === null
          ? (await client.refreshProjectContext(true)).chatDirectory
          : await invoke<string>("draft_directory", { cwd: directory })
      signal.throwIfAborted()
      const existing = workspaces.current.get(requested)
      if (existing) return existing
      const inFlight = opening.current.get(requested)
      if (inFlight) return inFlight
      const create = Effect.gen(function* () {
        const root = yield* workspaceTask(() => fsCommands.workspaceOpen({ path: requested }))
        signal.throwIfAborted()
        const saved = yield* workspaceTask(() => stateStore.load(root)).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              report(error)
              return null
            })
          )
        )
        signal.throwIfAborted()
        const fs = createFileSystem({
          adapter: createTauriAdapter({ root, collaborationOwner }),
          reportError: report
        })
        const editorFiles = (transaction: FsTransaction): FsTransaction => ({
          ...transaction,
          stat: async (path) =>
            containsPath(root, path) ? transaction.stat(path) : (await previewFiles({ root, fs }, path)).fs.stat(path),
          readFile: async (path) =>
            containsPath(root, path)
              ? transaction.readFile(path)
              : (await previewFiles({ root, fs }, path)).fs.readFile(path),
          createUrl: async (path) =>
            containsPath(root, path)
              ? transaction.createUrl(path)
              : (await previewFiles({ root, fs }, path)).fs.createUrl(path)
        })
        const editor = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createEditorController({
              fs: {
                ...fs,
                ...editorFiles(fs),
                transaction: (work) => fs.transaction((transaction) => work(editorFiles(transaction)))
              },
              reportError: report,
              confirmClose: async (document) => {
                const result = await ask({
                  title: t("workspace.unsaved"),
                  detail: document.path,
                  choices: [
                    { label: t("workspace.discard"), value: "discard" },
                    { label: t("workspace.save"), value: "save" }
                  ]
                })
                return result === null ? "cancel" : (result as CloseDecision)
              }
            })
          ),
          (editor) =>
            Effect.sync(() => editor.dispose()).pipe(
              Effect.ensuring(workspaceTask(async () => (await loadMonaco()).releaseMonaco(editor)).pipe(Effect.orDie))
            )
        )
        let expanded = saved?.expanded ?? [root]
        // assigned below once the editor exists; earlier tree callbacks skip persistence
        const late: { persistState?: () => void } = {}
        const tree = yield* Effect.acquireRelease(
          workspaceTask(() =>
            connectExplorerSettings(
              createFileTreeController({
                fs,
                root,
                reportError: report,
                expanded,
                onExpandedChange: (paths) => {
                  expanded = [...paths]
                  late.persistState?.()
                },
                confirmReplace: async (paths) =>
                  (await ask({
                    title: t("workspace.replace"),
                    detail: paths.join("\n"),
                    choices: [{ label: t("workspace.replace"), value: "replace" }]
                  })) === "replace"
              }),
              report
            )
          ),
          (tree) => Effect.sync(() => tree.dispose())
        )
        yield* workspaceTask(() => tree.refresh())
        signal.throwIfAborted()
        if (saved?.showIgnored) yield* workspaceTask(() => tree.setShowIgnored(true))
        for (const tab of saved?.tabs ?? []) {
          signal.throwIfAborted()
          const document = yield* workspaceTask(() => editor.open(tab.path)).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                signal.throwIfAborted()
                report(error)
                return null
              })
            )
          )
          signal.throwIfAborted()
          if (document && tab.pinned) editor.pin(document.id)
        }
        signal.throwIfAborted()
        const active = editor.getSnapshot().documents.find((doc) => doc.path === saved?.activePath)
        if (active) yield* workspaceTask(() => editor.open(active.path))
        signal.throwIfAborted()
        yield* Effect.acquireRelease(
          workspaceTask(() => fs.watch(root)),
          (stop) => Effect.sync(stop)
        )
        signal.throwIfAborted()
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            editor.subscribe(() => {
              const dirty = [...workspaces.current.values()].some((value) =>
                value.editor.getSnapshot().documents.some((doc) => doc.dirty)
              )
              if (dirty !== reportedDirty.current) {
                reportedDirty.current = dirty
                void invoke("workspace_dirty", { dirty }).catch(report)
              }
            })
          ),
          (stop) => Effect.sync(stop)
        )
        const tabs = yield* Effect.acquireRelease(
          Effect.sync(() => createFileTabs(editor, saved?.tabLayout)),
          (tabs) => Effect.sync(() => tabs.dispose())
        )
        const created = {
          root,
          fs,
          editor,
          tabs,
          tree,
          iconTheme: saved?.iconTheme ?? "vscode-icons",
          treeOpener: createTreeOpener(tabs, (path) =>
            openBoardRef.current(path)
              ? Promise.resolve(null)
              : prepareWorkspaceFile(path, {
                  readFile: async (target) =>
                    (containsPath(root, target) ? fs : await driveFileSystem(target)).readFile(target),
                  openTarget: (target) => routeDriveTarget.current(target)
                })
          )
        }
        yield* Effect.addFinalizer(() => Effect.sync(() => created.treeOpener.dispose()))
        let serialized = ""
        const persistState = () => {
          const snapshot = editor.getSnapshot(),
            treeSnapshot = tree.getSnapshot()
          const state: WorkspaceState = {
            tabs: snapshot.documents.map((doc) => ({ path: doc.path, pinned: doc.pinned })),
            activePath: snapshot.documents.find((doc) => doc.id === snapshot.activeId)?.path ?? null,
            expanded,
            showIgnored: treeSnapshot.showIgnored,
            iconTheme: created.iconTheme,
            tabLayout: created.tabs.serialize()
          }
          const next = JSON.stringify(state)
          if (next === serialized) return
          serialized = next
          void stateStore.save(root, state).catch((error) => {
            serialized = ""
            report(error)
          })
        }
        late.persistState = persistState
        for (const subscribe of [
          () => editor.subscribe(persistState),
          () => tree.subscribe(persistState),
          () => created.tabs.subscribe(persistState)
        ])
          yield* Effect.acquireRelease(Effect.sync(subscribe), (stop) => Effect.sync(stop))
        persistState()
        return created
      })
      const promise = openWorkspaceScope(signal, create, report).then((created) => {
        signal.throwIfAborted()
        workspaces.current.set(requested, created)
        return created
      })
      opening.current.set(requested, promise)
      try {
        return await promise
      } finally {
        if (opening.current.get(requested) === promise) opening.current.delete(requested)
      }
    },
    [ask, t, stateStore, previewFiles]
  )
  const openChatFile = useCallback(
    async (path: string, root: string | null, position?: FilePosition): Promise<void> => {
      const generation = ++requestGeneration.current
      const owner = currentCwd.current
      const current = () => generation === requestGeneration.current && owner === currentCwd.current
      const inside = root !== null && containsPath(root, path)
      const project = inside ? await ensure(root) : workspace
      const source = await previewFiles(project, path)
      const stat = await source.fs.stat(path)
      if (!current()) return
      if (stat === null) throw new Error(`Path does not exist: ${path}`)
      if (stat.kind === "directory") {
        if (!inside || project === null) return openLocalPath(path)
        await project.tree.reveal(path)
        if (!current()) return
        const node = project.tree.getSnapshot().rows.find((node) => node.path === path)
        if (node && !node.expanded) await project.tree.toggle(path)
        if (!current()) return
        project.tree.select(path)
        setWorkspace(project)
        setTreeVisible(true)
        setPane("files")
        setVisible(true)
        navigateCanvas?.("preview")
        return
      }
      if (inside && openBoardRef.current(path)) {
        navigateCanvas?.("preview")
        return
      }
      let redirected: string | undefined
      const destination = await prepareWorkspaceFile(
        path,
        {
          readFile: async (value) => (await previewFiles(project, value)).fs.readFile(value),
          openTarget: async (target) => {
            redirected = target
          }
        },
        { keepLargeFiles: true, openWeb: openChatWeb ?? openExternal }
      )
      const file = destination ?? redirected
      if (file === undefined || !current()) return
      const target = project ?? (await ensure(root))
      if (!current()) return
      await target.tabs.openFile(file, true)
      if (!current()) return
      if (inside && containsPath(target.root, file)) {
        await target.tree.reveal(file)
        if (!current()) return
        target.tree.select(file)
        setTreeVisible(true)
      }
      setWorkspace(target)
      setNavigation(position ? { path: file, position } : null)
      setPane("files")
      setVisible(true)
      navigateCanvas?.("preview")
    },
    [ensure, workspace, previewFiles, openChatWeb, navigateCanvas]
  )
  useLayoutEffect(() => {
    return registerOpenChatFile?.((path, position) => {
      if (isMac() && /\.app\/?$/i.test(path)) return openLocalPath(path)
      return openChatFile(path, workspace?.root ?? currentCwd.current, position)
    })
  }, [openChatFile, registerOpenChatFile, workspace?.root])
  const openFile = useCallback(
    async (path: string, root: string | null, position?: FilePosition): Promise<void> => {
      const generation = ++requestGeneration.current,
        owner = currentCwd.current
      if (root === null || !containsPath(root, path)) {
        await openExternalEntry(path)
        return
      }
      const authorized =
        workspace !== null && containsPath(workspace.root, path)
          ? workspace
          : [...workspaces.current.values()].find(
              (value) => root !== null && containsPath(value.root, root) && containsPath(value.root, path)
            )
      const base = root !== null && containsPath(root, path) ? root : dirname(path)
      let target = authorized ?? (await ensure(base))
      const stat = await target.fs.stat(path)
      if (stat === null) throw new Error(`Path does not exist: ${path}`)
      if (generation !== requestGeneration.current || owner !== currentCwd.current) return
      if (stat.kind === "directory") {
        target = await ensure(path)
        if (generation !== requestGeneration.current || owner !== currentCwd.current) return
        setWorkspace(target)
        setPane("files")
        setVisible(true)
        setTreeVisible(true)
        return
      }
      if (/\.html?$/i.test(path)) {
        await openHtmlInBrowser(path)
        return
      }
      if (openBoard(path)) return
      if (stat.size > maxEditorBytes && !isPdfPreview(path)) {
        await target.tree.reveal(path)
        if (generation !== requestGeneration.current || owner !== currentCwd.current) return
        target.tree.select(path)
        setWorkspace(target)
        setPane("files")
        setVisible(true)
        setTreeVisible(true)
        await openLocalPath(path)
        return
      }
      const destination = await prepareWorkspaceFile(path, {
        readFile: async (value) =>
          (containsPath(target.root, value) ? target.fs : await driveFileSystem(value)).readFile(value),
        openTarget: (value) => routeDriveTarget.current(value)
      })
      if (destination === null) return
      if (generation !== requestGeneration.current || owner !== currentCwd.current) return
      await target.tabs.openFile(destination, true)
      await target.tree.reveal(destination)
      if (generation !== requestGeneration.current || owner !== currentCwd.current) return
      target.tree.select(destination)
      setTreeVisible(true)
      setWorkspace(target)
      setNavigation(position ? { path: destination, position } : null)
      setPane("files")
      setVisible(true)
    },
    [ensure, workspace]
  )
  routeDriveTarget.current = async (path) => {
    const match = resolveDriveRoot(path, drive.getSnapshot().snapshot?.roots ?? [])
    if (!match) throw new Error("The linked file does not belong to an indexed Drive project")
    await openFile(path, match.base)
  }
  const openDriveLink = useCallback((path: string): Promise<void> => routeDriveTarget.current(path), [])
  useDriveDeepLinks(openDriveLink)
  const toggle = useCallback((): void => {
    if (visible && pane !== "files") {
      setPane("files")
      return
    }
    if (visible) {
      // Use the layout's effective state, including a preview moved onto the third screen.
      if (panelControls.current?.expanded) panelControls.current.toggleExpanded()
      else {
        setVisible(false)
        setViewMode(false)
      }
    } else {
      const generation = ++requestGeneration.current,
        owner = cwd
      void ensure(cwd)
        .then((value) => {
          if (generation !== requestGeneration.current || owner !== currentCwd.current) return
          setWorkspace(value)
          setPane("files")
          setViewMode(false)
          setVisible(true)
        })
        .catch(report)
    }
  }, [cwd, ensure, pane, visible])
  const showProjectTree = useCallback((): void => {
    const generation = ++requestGeneration.current,
      owner = cwd
    void ensure(cwd)
      .then((value) => {
        if (generation !== requestGeneration.current || owner !== currentCwd.current) return
        setWorkspace(value)
        setPane("files")
        setVisible(true)
        setTreeVisible(true)
      })
      .catch(report)
  }, [cwd, ensure])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "e")
        return
      event.preventDefault()
      showProjectTree()
    }
    window.addEventListener("keydown", onKeyDown)
    const subscription = isTauri() ? getCurrentWindow().listen("menu:project-tree", showProjectTree) : null
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      if (subscription) void subscription.then((stop) => stop()).catch(report)
    }
  }, [showProjectTree])
  const openProject = useCallback(
    async (path: string): Promise<void> => {
      const generation = ++requestGeneration.current,
        owner = currentCwd.current
      const target = await ensure(path)
      if (generation !== requestGeneration.current || currentCwd.current !== owner) return
      setWorkspace(target)
      setPane("files")
      setVisible(true)
      setTreeVisible(true)
    },
    [ensure]
  )
  const previousCwd = useRef(cwd)
  useEffect(() => {
    if (previousCwd.current === cwd) return
    previousCwd.current = cwd
    const generation = ++requestGeneration.current
    if (!visible) return
    setWorkspace(null)
    let cancelled = false
    void ensure(cwd)
      .then((value) => {
        if (!cancelled && generation === requestGeneration.current) setWorkspace(value)
      })
      .catch((error: unknown) => {
        if (!cancelled && generation === requestGeneration.current) report(error)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, ensure, visible])
  useEffect(() => {
    if (!revealFolder || (cwd !== null && !sameChatDirectory(cwd, revealFolder.cwd))) return
    const generation = ++requestGeneration.current
    let active = true
    const isCurrent = (): boolean => active && generation === requestGeneration.current
    void ensure(revealFolder.cwd)
      .then(async (target) => {
        if (!isCurrent()) return
        await target.tree.reveal(revealFolder.path)
        if (!isCurrent()) return
        const row = target.tree.getSnapshot().rows.find((row) => row.path === normalizePath(revealFolder.path))
        if (row && !row.expanded) await target.tree.toggle(row.path)
        if (!isCurrent()) return
        setWorkspace(target)
        setPane("files")
        setVisible(true)
        setTreeVisible(true)
      })
      .catch((error: unknown) => {
        if (isCurrent()) report(error)
      })
    return () => {
      active = false
    }
  }, [cwd, ensure, revealFolder])
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent): void {
      if (
        [...workspaces.current.values()].some((value) => value.editor.getSnapshot().documents.some((doc) => doc.dirty))
      ) {
        event.preventDefault()
      }
    }
    function refresh(): void {
      if (workspace) void workspace.tree.refresh().catch(report)
    }
    window.addEventListener("beforeunload", beforeUnload)
    window.addEventListener("focus", refresh)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      window.removeEventListener("focus", refresh)
    }
  }, [workspace])
  useEffect(() => {
    if (!isTauri()) return
    let closing = false
    const requestExit = (): void => {
      if (closing) return
      closing = true
      void (async () => {
        const approved = new Map(
          [...workspaces.current.values()].map((value) => [
            value,
            value.editor.getSnapshot().documents.map((doc) => ({ id: doc.id, contentRevision: doc.contentRevision }))
          ])
        )
        for (const value of approved.keys()) if (!(await value.editor.prepareShutdown())) return
        // Confirmation for one project cannot approve later edits in another project.
        if (approved.size !== workspaces.current.size) return
        for (const [value, documents] of approved) {
          const current = value.editor.getSnapshot().documents
          if (
            current.length !== documents.length ||
            current.some(
              (doc) =>
                !documents.some((before) => before.id === doc.id && before.contentRevision === doc.contentRevision)
            )
          )
            return
        }
        await invoke("workspace_exit")
      })()
        .catch(report)
        .finally(() => {
          closing = false
        })
    }
    const exitListener = listen("workspace:shutdown", requestExit)
    return () => {
      void exitListener.then((stop) => stop()).catch(report)
    }
  }, [])
  useEffect(() => {
    if (lifecycle.current.signal.aborted) lifecycle.current = new AbortController()
    const activeLifecycle = lifecycle.current
    const currentWorkspaces = workspaces.current
    const currentOpening = opening.current
    return () => {
      activeLifecycle.abort()
      currentWorkspaces.clear()
      currentOpening.clear()
    }
  }, [])
  useEffect(() => {
    if (!isTauri() || workspace === null || !visible) return
    const owner = workspace
    let cancelled = false
    const listener = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return
      const payload = event.payload
      void (async () => {
        const scale = await getCurrentWindow().scaleFactor()
        if (cancelled) return
        const element = document.elementFromPoint(payload.position.x / scale, payload.position.y / scale)
        if (!element?.closest(".file-workspace-tree")) return
        const row = element.closest<HTMLElement>("[data-file-path]")
        let destination = owner.root
        if (row !== null) {
          const path = row.getAttribute("data-file-path")
          if (path === null) throw new Error("File drop target is missing its path")
          destination = row.dataset.fileKind === "directory" ? path : dirname(path)
        }
        await invoke("workspace_import", { root: owner.root, destination, paths: payload.paths })
        await owner.tree.refresh()
      })().catch(report)
    })
    return () => {
      cancelled = true
      void listener.then((stop) => stop()).catch(report)
    }
  }, [workspace, visible])
  useEffect(() => {
    let disposed = false
    const newTab = (): void => {
      if (document.querySelector('[role="dialog"]')) return
      const generation = ++requestGeneration.current
      const owner = cwd
      void ensure(cwd)
        .then((target) => {
          if (disposed || generation !== requestGeneration.current || owner !== currentCwd.current) return
          if (
            target === workspace ||
            target.tabs.getSnapshot().tabs.length !== 1 ||
            target.tabs.getSnapshot().tabs[0].kind !== "new"
          )
            target.tabs.openNewTab()
          setWorkspace(target)
          setPane("files")
          setVisible(true)
        })
        .catch(report)
    }
    const closeTab = (): void => {
      if (!workspace || document.querySelector('[role="dialog"]')) return
      const id = workspace.tabs.getSnapshot().activeId
      if (id !== null) void workspace.tabs.requestClose(id).catch(report)
    }
    const reopenTab = (): void => {
      if (!workspace || document.querySelector('[role="dialog"]')) return
      void workspace.tabs
        .reopenClosed()
        .then(() => {
          if (!disposed) setVisible(true)
        })
        .catch(report)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === "t") {
        event.preventDefault()
        if (event.shiftKey) reopenTab()
        else newTab()
      } else if (key === "w" && !event.shiftKey && visible) {
        event.preventDefault()
        closeTab()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    const subscriptions = isTauri()
      ? [
          getCurrentWindow().listen("menu:new-tab", newTab),
          getCurrentWindow().listen("menu:close-tab", closeTab),
          getCurrentWindow().listen("menu:reopen-closed-tab", reopenTab)
        ]
      : []
    return () => {
      disposed = true
      window.removeEventListener("keydown", onKeyDown)
      for (const subscription of subscriptions) void subscription.then((stop) => stop()).catch(report)
    }
  }, [cwd, ensure, visible, workspace])
  const revealEntry = useCallback(
    async (path: string, root: string): Promise<void> => {
      const generation = ++requestGeneration.current,
        owner = currentCwd.current
      const target = await ensure(root)
      if (generation !== requestGeneration.current || owner !== currentCwd.current) return
      await target.tree.reveal(path)
      if (generation !== requestGeneration.current || owner !== currentCwd.current) return
      target.tree.select(path)
      setWorkspace(target)
      setPane("files")
      setVisible(true)
      setTreeVisible(true)
    },
    [ensure]
  )
  const openPane = useCallback(
    (next: WorkspacePane): void => {
      if (next === "terminal" && (!terminalAvailable || paneSessionId === null)) return
      if (next === "files") {
        if (!visible || pane !== "files") {
          setPane("files")
          if (!visible) toggle()
        } else toggle()
        return
      }
      requestGeneration.current++
      // Selecting a retained pane from another screen reveals it instead of closing it.
      if (visible && pane === next && (!canvas || canvas.region === "chat" || canvas.region === "preview")) {
        setVisible(false)
        setViewMode(false)
        setPane("files")
        return
      }
      if (next === "simulator" && paneSessionId) {
        const session = paneSessionId
        void focusDeviceWindow(session)
          .then((found) => {
            if (currentPaneSession.current !== session) return
            if (!found) {
              setPane("simulator")
              setVisible(true)
              navigateCanvas?.("preview")
            }
          })
          .catch((error: unknown) => toast.error(String(error)))
        return
      }
      setPane(next)
      setVisible(true)
      navigateCanvas?.("preview")
    },
    [visible, pane, toggle, navigateCanvas, canvas, terminalAvailable, paneSessionId]
  )
  const revealDevice = useCallback(() => {
    requestGeneration.current++
    setPane("simulator")
    setVisible(true)
    navigateCanvas?.("preview")
  }, [navigateCanvas])
  const revealAttachedDevice = useCallback(() => {
    if (!paneSessionId) return
    const session = paneSessionId
    void focusDeviceWindow(session)
      .then((found) => {
        if (!found && currentPaneSession.current === session) revealDevice()
      })
      .catch((error: unknown) => toast.error(String(error)))
  }, [paneSessionId, revealDevice])
  useDeviceReveal(paneSessionId, revealAttachedDevice)
  useDeviceWindowReturn(paneSessionId, revealDevice)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "j" ||
        !terminalAvailable ||
        paneSessionId === null
      )
        return
      event.preventDefault()
      event.stopPropagation()
      openPane("terminal")
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [terminalAvailable, paneSessionId, openPane])
  const context = useMemo(
    () => ({
      visible,
      viewMode,
      pane,
      openPane,
      toggle,
      openFile,
      openChatFile,
      openProject,
      revealEntry,
      registerFileReference
    }),
    [visible, viewMode, pane, openPane, toggle, openFile, openChatFile, openProject, revealEntry, registerFileReference]
  )
  const treeLabels: FileTreeLabels = {
    files: t("workspace.files"),
    filter: t("workspace.filter"),
    empty: t("workspace.empty"),
    loading: t("workspace.loading"),
    refresh: t("workspace.refresh"),
    newFile: t("workspace.newFile"),
    newFolder: t("workspace.newFolder"),
    rename: t("workspace.rename"),
    remove: t("workspace.remove"),
    copy: t("workspace.copy"),
    cut: t("workspace.cut"),
    paste: t("workspace.paste"),
    hidden: t("workspace.hidden"),
    openExternal: t("workspace.openExternal")
  }
  const editorLabels: EditorLabels = {
    empty: t("workspace.selectFile"),
    save: t("workspace.save"),
    saveAs: t("workspace.saveAs"),
    saving: t("workspace.saving"),
    close: t("workspace.close"),
    edit: t("workspace.edit"),
    preview: t("workspace.preview"),
    source: t("workspace.source"),
    viewMode: t("workspace.viewMode"),
    reload: t("workspace.reload"),
    changed: t("workspace.changed"),
    unsupported: t("workspace.unsupported"),
    openExternal: t("workspace.openExternal"),
    loading: t("workspace.loading"),
    loadFailed: t("workspace.loadFailed"),
    tooLarge: t("workspace.previewTooLarge"),
    openAnyway: t("workspace.openAnyway"),
    retry: t("workspace.retry")
  }
  // The board belongs to the project; the other panes belong to a conversation.
  const paneReady = pane === "files" ? workspace !== null : pane === "board" ? cwd !== null : paneSessionId !== null
  return (
    <WorkspaceContext.Provider value={context}>
      {headerTarget !== null &&
        createPortal(
          <div className="file-workspace-toolbar">
            <ChatCondenseEntry
              cwd={cwd}
              controller={drive}
              controls={driveControls}
              locale={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
              host={condenseHost}
              onBackgroundError={report}
              onCondense={(scope, job) => {
                setCondenseJob(job)
                setCondenseScope(scope)
              }}
            />
            <WorkspaceButton />
            <DeviceWorkspaceMenu>
              {browserEntry}
              <TerminalWorkspaceMenuItem />
              <BoardMenuItem />
            </DeviceWorkspaceMenu>
          </div>,
          headerTarget
        )}
      <WorkspacePanels
        controlsRef={panelControls}
        visible={visible && paneReady}
        maximized={visible && paneReady && viewMode}
        onMaximizedChange={setViewMode}
        chat={children}
        preview={
          pane === "board" && cwd !== null ? (
            <BoardPane
              cwd={cwd}
              file={boardFile}
              sessionId={paneSessionId}
              onClose={() => {
                setVisible(false)
                setViewMode(false)
                setPane("files")
              }}
            />
          ) : pane === "background" && paneSessionId !== null ? (
            <BackgroundWorkspacePane
              key={paneSessionId}
              sessionId={paneSessionId}
              onClose={() => {
                setVisible(false)
                setViewMode(false)
                setPane("files")
              }}
            />
          ) : pane === "terminal" && paneSessionId !== null ? (
            <TerminalWorkspacePane
              key={paneSessionId}
              sessionId={paneSessionId}
              cwd={cwd}
              onClose={() => {
                setVisible(false)
                setViewMode(false)
                setPane("files")
              }}
            />
          ) : pane === "simulator" && paneSessionId !== null ? (
            <DeviceWorkspacePane
              key={paneSessionId}
              sessionId={paneSessionId}
              maximized={viewMode}
              onMaximize={() => setViewMode((value) => !value)}
              onClose={() => {
                setVisible(false)
                setViewMode(false)
                setPane("files")
              }}
            />
          ) : (
            workspace && (
              <PreviewSurface
                treeVisible={treeVisible}
                onTreeVisibleChange={setTreeVisible}
                maximized={viewMode}
                onMaximize={() => setViewMode((value) => !value)}
                onClose={() => {
                  setVisible(false)
                  setViewMode(false)
                }}
                tree={(treeToggle) => (
                  <FileTree
                    explorerControl={treeToggle}
                    controller={workspace.tree}
                    collapsed={!treeVisible}
                    isDark={resolvedTheme === "dark"}
                    iconTheme={iconTheme ?? workspace.iconTheme}
                    activePath={
                      activeDocument && containsPath(workspace.root, activeDocument.path) ? activeDocument.path : null
                    }
                    labels={treeLabels}
                    onError={report}
                    onOpenFile={(path) => workspace.treeOpener.open(path)}
                    getLeadingAction={({ kind, path }) => {
                      if (kind !== "directory" || !onChatInFolder) return null
                      const cwd = resolveDriveRoot(path, driveState?.roots ?? [])?.root.localPath ?? path
                      return {
                        label: t("workspace.chatInFolder"),
                        onSelect: () => onChatInFolder({ cwd, path })
                      }
                    }}
                    renderActions={(paths) => {
                      const path = paths[0]
                      if (
                        paths.length > 1 &&
                        driveState?.running &&
                        paths.every((path) => {
                          const hit = resolveDriveRoot(path, driveState.roots)
                          return hit !== null && hit.root.canWrite && path !== hit.base
                        })
                      )
                        return (
                          <ContextMenuItem onClick={() => setPublishSources({ owner: workspace, paths })}>
                            {t("workspace.publishTo")}
                          </ContextMenuItem>
                        )
                      if (
                        paths.length !== 1 ||
                        path === undefined ||
                        !driveState?.running ||
                        !driveState.roots.some((root) => containsPath(root.localPath, path))
                      )
                        return null
                      const isDirectory = workspace.tree
                        .getSnapshot()
                        .rows.some((row) => row.path === path && row.kind === "directory")
                      return (
                        <DriveTreeActions
                          path={path}
                          isDirectory={isDirectory}
                          onSharing={setSharingPath}
                          onCondense={(scope) => {
                            setCondenseJob(undefined)
                            setCondenseScope(scope)
                          }}
                          onMove={(path, kind) => setMoveTarget({ path, kind })}
                          onPublish={(path) => setPublishSources({ owner: workspace, paths: [path] })}
                          saveDocument={saveDriveDocument}
                        />
                      )
                    }}
                    renderDecoration={(row) => (
                      <DriveBadge
                        controller={drive}
                        path={row.path}
                        isDirectory={row.kind === "directory"}
                        locale={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
                      />
                    )}
                    onPinFile={(path) => {
                      const target = fileReference.current
                      if (target !== null) target.add(path)
                      return workspace.treeOpener.open(path, true)
                    }}
                    onOpenExternal={openExternal}
                    onReveal={(path) => revealInFileManager(path)}
                    onCopyPath={writeText}
                    onMove={(paths) => {
                      return Promise.try(() => {
                        setMoveSources({ owner: workspace, paths })
                      })
                    }}
                    onImport={async (destination, directory) => {
                      const paths = await openDialog({
                        directory,
                        multiple: true,
                        title: t(directory ? "workspace.importFolder" : "workspace.importFiles")
                      })
                      if (paths === null) return
                      await invoke("workspace_import", { root: workspace.root, destination, paths })
                      await workspace.tree.refresh()
                    }}
                    explorerLabels={{
                      explorer: t("workspace.explorer"),
                      search: t("workspace.search"),
                      collapse: t("workspace.collapse"),
                      more: t("workspace.more"),
                      ignored: t("workspace.ignored"),
                      newMarkdown: t("workspace.newMarkdown"),
                      copyPath: t("workspace.copyPath"),
                      copyRelativePath: t("workspace.copyRelativePath"),
                      moveTo: t("workspace.moveTo"),
                      reveal: t("workspace.reveal"),
                      importFiles: t("workspace.importFiles"),
                      importFolder: t("workspace.importFolder"),
                      open: t("workspace.open"),
                      closeSearch: t("workspace.closeSearch"),
                      previousMatch: t("workspace.previousMatch"),
                      nextMatch: t("workspace.nextMatch")
                    }}
                    requestName={(action, current) =>
                      ask({
                        title: t(
                          action === "rename"
                            ? "workspace.rename"
                            : action === "file"
                              ? "workspace.newFile"
                              : "workspace.newFolder"
                        ),
                        detail: workspace.root,
                        initial: current,
                        choices: [{ label: t("workspace.confirm"), value: "confirm" }]
                      })
                    }
                    confirmDelete={async (paths) =>
                      (await ask({
                        title: t("workspace.remove"),
                        detail: paths.join("\n"),
                        choices: [{ label: t("workspace.remove"), value: "delete" }]
                      })) === "delete"
                    }
                  />
                )}
                editor={({ leading, trailing }) => (
                  <DriveDocumentSurface host={contentHost} path={activeDocument?.path ?? null}>
                    <ChatDirectoryContext.Provider value={workspace.root}>
                      <WorkspaceEditor
                        tabs={workspace.tabs}
                        leading={leading}
                        trailing={trailing}
                        iconTheme={iconTheme ?? workspace.iconTheme}
                        isDark={resolvedTheme === "dark"}
                        readOnly={
                          driveReadOnly || Boolean(activeDocument && !containsPath(workspace.root, activeDocument.path))
                        }
                        sourceReadOnly={driveSourceReadOnly || activeCollaborationOwner !== undefined}
                        controller={workspace.editor}
                        labels={editorLabels}
                        compactToolbar
                        rootPath={navigator.platform.includes("Win") ? normalizePath(workspace.root) : workspace.root}
                        onRevealPath={async (path) => {
                          if (containsPath(workspace.root, path)) await workspace.tree.reveal(path)
                          else await openLocalPath(path)
                        }}
                        onReveal={(document) => revealInFileManager(document.path)}
                        onCopyPath={(document) => writeText(document.path)}
                        tabLabels={{
                          closeOthers: t("workspace.closeOthers"),
                          closeRight: t("workspace.closeRight"),
                          closeSaved: t("workspace.closeSaved"),
                          closeAll: t("workspace.closeAll"),
                          copyPath: t("workspace.copyPath"),
                          reveal: t("workspace.reveal")
                        }}
                        actionsLabel={t("workspace.more")}
                        onError={report}
                        onOpenExternal={(document) => openLocalPath(document.path)}
                        statFile={statPreviewFile}
                        previews={previews}
                        requestSaveAs={async (document) =>
                          ask({
                            title: t("workspace.saveAs"),
                            detail: workspace.root,
                            initial: document.path,
                            choices: [{ label: t("workspace.save"), value: "save" }]
                          })
                        }
                        renderTextEditor={(props) => (
                          <Suspense
                            fallback={<div className="p-6 text-sm text-muted-foreground">{t("workspace.loading")}</div>}
                          >
                            <CodeEditor
                              {...props}
                              controller={workspace.editor}
                              settings={settings}
                              onError={report}
                              position={navigation?.path === props.document.path ? navigation.position : undefined}
                            />
                          </Suspense>
                        )}
                      />
                    </ChatDirectoryContext.Provider>
                  </DriveDocumentSurface>
                )}
              />
            )
          )
        }
      />
      {publishSources && (
        <MoveToDialog
          mode="publish"
          sources={publishSources.paths}
          rootPath={publishSources.owner.root}
          fs={publishSources.owner.fs}
          tree={publishSources.owner.tree}
          onClose={() => setPublishSources(null)}
          onMoveTo={() => {
            return Promise.reject(new Error("Publishing cannot move local files"))
          }}
        />
      )}
      {moveSources && (
        <MoveToDialog
          sources={moveSources.paths}
          rootPath={moveSources.owner.root}
          fs={moveSources.owner.fs}
          tree={moveSources.owner.tree}
          onClose={() => setMoveSources(null)}
          onMoveTo={async (paths, directory) =>
            moveWorkspaceFiles(paths, directory, {
              owners: [...workspaces.current.values()],
              invokeMove: async (sources, destination) => {
                const result = await invoke<WorkspaceMoveOutcome>("workspace_move_to", {
                  root: moveSources.owner.root,
                  sources,
                  destination
                })
                const profile = drive.getSnapshot().snapshot
                for (const moved of result.moves)
                  rebaseDrivePins(`${profile?.baseUrl ?? ""}|${profile?.localRoot ?? ""}`, moved.from, moved.to)
                for (const owner of workspaces.current.values()) {
                  try {
                    await owner.tree.refresh()
                  } catch (error) {
                    report(error)
                  }
                }
                return result
              },
              open: async (path, pinned, active) => {
                if (openBoard(path)) return
                const match = resolveDriveRoot(path, drive.getSnapshot().snapshot?.roots ?? [])
                const target = await ensure(match?.base ?? directory)
                const previousActive = target.tabs.getSnapshot().activeId
                await target.tabs.openFile(path, pinned)
                if (active) setWorkspace(target)
                else if (previousActive !== null) target.tabs.activate(previousActive)
              }
            })
          }
        />
      )}
      <Dialog
        open={condenseScope !== null}
        onOpenChange={(open) => {
          if (!open) setCondenseScope(null)
        }}
      >
        <DialogContent className={driveDialogClassName}>
          <DialogHeader>
            <DialogTitle>{i18n.language.startsWith("zh") ? "沉淀为知识" : "Condense into knowledge"}</DialogTitle>
          </DialogHeader>
          {condenseScope && (
            <DriveCondense
              key={`${condenseScope.projectId}:${condenseJob?.id ?? "manual"}`}
              initialJob={condenseJob}
              controller={drive}
              controls={driveControls}
              scope={condenseScope}
              locale={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
              onClose={() => setCondenseScope(null)}
              onOpenExternal={openExternal}
              onOpenFile={async (path) => {
                await workspace?.treeOpener.open(path)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={moveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMoveTarget(null)
        }}
      >
        <DialogContent className={driveDialogClassName}>
          <DialogHeader>
            <DialogTitle>{i18n.language.startsWith("zh") ? "移动到其他项目" : "Move to another project"}</DialogTitle>
          </DialogHeader>
          {moveTarget && (
            <DriveMoveDialog
              {...moveTarget}
              controller={drive}
              controls={driveControls}
              locale={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
              onClose={() => setMoveTarget(null)}
              host={{
                confirm: (message) => confirm(message, { title: "YUP Drive", kind: "warning" }),
                prepareMove: async (path) => {
                  for (const owner of workspaces.current.values()) {
                    const ids = owner.editor
                      .getSnapshot()
                      .documents.filter((doc) => containsPath(path, doc.path))
                      .map((doc) => doc.id)
                    if (!(await owner.editor.requestCloseMany(ids))) return false
                  }
                  return true
                },
                onMoved: async (source, destination) => {
                  const profile = drive.getSnapshot().snapshot
                  rebaseDrivePins(`${profile?.baseUrl ?? ""}|${profile?.localRoot ?? ""}`, source, destination)
                  for (const owner of workspaces.current.values()) await owner.tree.refresh()
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      {dialog}
      <DriveSharingDialog path={sharingPath} onClose={() => setSharingPath(null)} />
    </WorkspaceContext.Provider>
  )
}
