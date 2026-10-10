import { openExternal } from "@/lib/open"
import { createFileSystem, containsPath, dirname, type FileSystem } from "@alwith/module-fs"
import { createTauriAdapter } from "@alwith/module-fs/tauri"
import {
  createFileTreeController,
  FileTree,
  type FileTreeController,
  type FileTreeLabels
} from "@alwith/module-file-tree"
import {
  createEditorController,
  EditorWorkbench,
  ImagePreview,
  type CloseDecision,
  type EditorController,
  type EditorLabels
} from "@alwith/module-editor"
import "@alwith/module-file-tree/styles.css"
import "@alwith/module-editor/styles.css"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { revealItemsInDir } from "@tauri-apps/plugin-opener"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { FolderTree, Maximize2, Minimize2, Settings2 } from "lucide-react"
import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode
} from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { ChatDirectoryContext } from "@/features/chat/file-actions"
import { WorkspaceContext, WorkspaceHeaderContext } from "./context"
import { WorkspaceButton } from "./workspace-button"
import { useHostDialog } from "./host-dialog"
import "./workspace.css"
import { createTreeOpener } from "./tree-opener"
import { createWorkspaceStateStore, type IconTheme, type WorkspaceState } from "./workspace-state"
import { defaultEditorSettings, loadEditorSettings, saveEditorSettings } from "./editor-settings"
import { EditorSettingsDialog } from "./editor-settings-dialog"
import { routeHistory, routeReplace } from "./editor-shortcuts"
import { localPreviewProviders } from "./local-previews"
import { resolvePreviewResource } from "./preview-resources"
import "@alwith/module-editor/previews/styles.css"
const loadMonaco = () => import("./monaco-editor")
const CodeEditor = lazy(loadMonaco)
interface Workspace {
  root: string
  fs: FileSystem
  tree: FileTreeController
  editor: EditorController
  treeOpener: ReturnType<typeof createTreeOpener>
  stopWatching: () => void
  stopDirty: () => void
  stopState: () => void
  iconTheme: IconTheme
  setIconTheme: (theme: IconTheme) => void
}
const emptyEditorSnapshot = (): null => null
const noEditorSubscription = (): (() => void) => () => {}
function report(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error))
}
export function FileWorkspace({ cwd, children }: { cwd: string | null; children: ReactNode }) {
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation(),
    { ask, dialog } = useHostDialog()
  const workspaces = useRef(new Map<string, Workspace>()),
    opening = useRef(new Map<string, Promise<Workspace>>())
  const lifecycle = useRef(new AbortController())
  const stateStore = useMemo(() => createWorkspaceStateStore(), [])
  const [settings, setSettings] = useState(() => {
    try {
      return loadEditorSettings()
    } catch (error) {
      report(error)
      return defaultEditorSettings
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [, refreshIconTheme] = useState(0)
  const headerTarget = useContext(WorkspaceHeaderContext)
  const [visible, setVisible] = useState(false),
    [treeVisible, setTreeVisible] = useState(true),
    [viewMode, setViewMode] = useState(false),
    [width, setWidth] = useState(58)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const editorSnapshot = useSyncExternalStore(
    workspace ? workspace.editor.subscribe : noEditorSubscription,
    workspace ? workspace.editor.getSnapshot : emptyEditorSnapshot
  )
  const activeDocument = editorSnapshot?.documents.find(document => document.id === editorSnapshot.activeId)
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
      ...localPreviewProviders({
        resolveResource: (path, reference) => resolvePreviewResource(workspace.fs, workspace.root, path, reference),
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
          page: t("workspace.page"),
          thumbnails: t("workspace.thumbnails"),
          zoomIn: t("workspace.zoomIn"),
          zoomOut: t("workspace.zoomOut"),
          resetZoom: t("workspace.resetZoom")
        }
      })
    ]
  }, [workspace, t])
  const container = useRef<HTMLDivElement>(null)
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
      for (const subscription of subscriptions) void subscription.then(stop => stop()).catch(report)
    }
  }, [])
  const ensure = useCallback(
    async (directory: string | null): Promise<Workspace> => {
      const signal = lifecycle.current.signal
      signal.throwIfAborted()
      const requested = await invoke<string>("draft_directory", { cwd: directory })
      signal.throwIfAborted()
      const existing = workspaces.current.get(requested)
      if (existing) return existing
      const inFlight = opening.current.get(requested)
      if (inFlight) return inFlight
      const create = async (): Promise<Workspace> => {
        const root = await invoke<string>("workspace_open", { path: requested })
        signal.throwIfAborted()
        let saved: WorkspaceState | null = null
        try {
          saved = await stateStore.load(root)
        } catch (error) {
          report(error)
        }
        signal.throwIfAborted()
        const fs = createFileSystem({
          adapter: createTauriAdapter({
            root,
            transport: { invoke: request => invoke("workspace_file", { request }) },
            watch: async (path, changed, onError) => {
              const stop = await listen<{ root: string; paths: string[]; error: string | null }>(
                "workspace:change",
                event => {
                  if (event.payload.root !== root) return
                  if (event.payload.error !== null) onError(new Error(event.payload.error))
                  else changed(event.payload.paths)
                }
              )
              try {
                await invoke("workspace_watch", { path, enabled: true })
              } catch (error) {
                stop()
                throw error
              }
              return () => {
                stop()
                void invoke("workspace_watch", { path, enabled: false }).catch(report)
              }
            }
          }),
          reportError: report
        })
        const editor = createEditorController({
          fs,
          reportError: report,
          confirmClose: async document => {
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
        let expanded = saved?.expanded ?? [root]
        let persistState: (() => void) | undefined
        const tree = createFileTreeController({
          fs,
          root,
          reportError: report,
          expanded,
          onExpandedChange: paths => {
            expanded = [...paths]
            persistState?.()
          },
          confirmReplace: async paths =>
            (await ask({
              title: t("workspace.replace"),
              detail: paths.join("\n"),
              choices: [{ label: t("workspace.replace"), value: "replace" }]
            })) === "replace"
        })
        try {
          await tree.refresh()
          signal.throwIfAborted()
          if (saved?.showHidden) await tree.setShowHidden(true)
          if (saved?.showIgnored) await tree.setShowIgnored(true)
          for (const tab of saved?.tabs ?? []) {
            signal.throwIfAborted()
            try {
              const document = await editor.open(tab.path)
              signal.throwIfAborted()
              if (tab.pinned) editor.pin(document.id)
            } catch (error) {
              signal.throwIfAborted()
              report(error)
            }
          }
          signal.throwIfAborted()
          const active = editor.getSnapshot().documents.find(doc => doc.path === saved?.activePath)
          if (active) await editor.open(active.path)
          signal.throwIfAborted()
        } catch (error) {
          tree.dispose()
          editor.dispose()
          throw error
        }
        let stopWatching: () => void
        try {
          stopWatching = await fs.watch(root)
          if (signal.aborted) {
            stopWatching()
            signal.throwIfAborted()
          }
        } catch (error) {
          tree.dispose()
          editor.dispose()
          throw error
        }
        const stopDirty = editor.subscribe(() => {
          const dirty = [...workspaces.current.values()].some(value =>
            value.editor.getSnapshot().documents.some(doc => doc.dirty)
          )
          if (dirty !== reportedDirty.current) {
            reportedDirty.current = dirty
            void invoke("workspace_dirty", { dirty }).catch(report)
          }
        })
        const created: Workspace = {
          root,
          fs,
          editor,
          tree,
          stopWatching,
          stopDirty,
          stopState: () => {},
          iconTheme: saved?.iconTheme ?? "vscode-icons",
          setIconTheme: theme => {
            created.iconTheme = theme
            persistState?.()
            refreshIconTheme(value => value + 1)
          },
          treeOpener: createTreeOpener(editor)
        }
        let serialized = ""
        persistState = () => {
          const snapshot = editor.getSnapshot(),
            treeSnapshot = tree.getSnapshot()
          const state: WorkspaceState = {
            tabs: snapshot.documents.map(doc => ({ path: doc.path, pinned: doc.pinned })),
            activePath: snapshot.documents.find(doc => doc.id === snapshot.activeId)?.path ?? null,
            expanded,
            showHidden: treeSnapshot.showHidden,
            showIgnored: treeSnapshot.showIgnored,
            iconTheme: created.iconTheme
          }
          const next = JSON.stringify(state)
          if (next === serialized) return
          serialized = next
          void stateStore.save(root, state).catch(error => {
            serialized = ""
            report(error)
          })
        }
        const stopEditorState = editor.subscribe(persistState),
          stopTreeState = tree.subscribe(persistState)
        created.stopState = () => {
          stopEditorState()
          stopTreeState()
        }
        persistState()
        workspaces.current.set(requested, created)
        return created
      }
      const promise = create()
      opening.current.set(requested, promise)
      try {
        return await promise
      } finally {
        if (opening.current.get(requested) === promise) opening.current.delete(requested)
      }
    },
    [ask, t, stateStore]
  )
  const openFile = useCallback(
    async (path: string, root: string | null): Promise<void> => {
      const generation = ++requestGeneration.current,
        owner = currentCwd.current
      const authorized = [...workspaces.current.values()].find(
        value => root !== null && containsPath(value.root, root) && containsPath(value.root, path)
      )
      const target = authorized === undefined ? await ensure(root) : authorized
      if (!containsPath(target.root, path)) throw new Error(t("workspace.outside"))
      await target.editor.open(path)
      if (generation !== requestGeneration.current || owner !== currentCwd.current) return
      setWorkspace(target)
      setVisible(true)
    },
    [ensure, t]
  )
  const toggle = useCallback((): void => {
    if (visible) {
      setVisible(false)
      setViewMode(false)
    } else {
      const generation = ++requestGeneration.current,
        owner = cwd
      void ensure(cwd)
        .then(value => {
          if (generation !== requestGeneration.current || owner !== currentCwd.current) return
          setWorkspace(value)
          setVisible(true)
        })
        .catch(report)
    }
  }, [cwd, ensure, visible])
  const previousCwd = useRef(cwd)
  useEffect(() => {
    if (previousCwd.current === cwd) return
    previousCwd.current = cwd
    requestGeneration.current++
    if (!visible) return
    setWorkspace(null)
    let cancelled = false
    void ensure(cwd)
      .then(value => {
        if (!cancelled) setWorkspace(value)
      })
      .catch(report)
    return () => {
      cancelled = true
    }
  }, [cwd, ensure, visible])
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent): void {
      if ([...workspaces.current.values()].some(value => value.editor.getSnapshot().documents.some(doc => doc.dirty))) {
        event.preventDefault()
        event.returnValue = ""
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
    const win = getCurrentWindow()
    let closing = false
    const requestExit = (): void => {
      if (closing) return
      closing = true
      void (async () => {
        const approved = new Map(
          [...workspaces.current.values()].map(value => [
            value,
            value.editor.getSnapshot().documents.map(doc => ({ id: doc.id, contentRevision: doc.contentRevision }))
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
              doc => !documents.some(before => before.id === doc.id && before.contentRevision === doc.contentRevision)
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
    const listener = win.onCloseRequested(event => {
      event.preventDefault()
      requestExit()
    })
    return () => {
      void listener.then(stop => stop()).catch(report)
      void exitListener.then(stop => stop()).catch(report)
    }
  }, [])
  useEffect(() => {
    if (lifecycle.current.signal.aborted) lifecycle.current = new AbortController()
    const activeLifecycle = lifecycle.current
    const currentWorkspaces = workspaces.current
    const currentOpening = opening.current
    return () => {
      activeLifecycle.abort()
      const instances = [...currentWorkspaces.values()]
      currentWorkspaces.clear()
      currentOpening.clear()
      for (const value of instances) {
        value.stopWatching()
        value.stopDirty()
        value.stopState()
        value.treeOpener.dispose()
        value.tree.dispose()
        value.editor.dispose()
      }
      if (instances.length)
        void loadMonaco()
          .then(module => {
            for (const value of instances) module.releaseMonaco(value.editor)
          })
          .catch(report)
    }
  }, [])
  useEffect(() => {
    if (!isTauri() || workspace === null || !visible) return
    const owner = workspace
    let cancelled = false
    const listener = getCurrentWindow().onDragDropEvent(event => {
      if (event.payload.type !== "drop") return
      const payload = event.payload
      void (async () => {
        const scale = await getCurrentWindow().scaleFactor()
        if (cancelled) return
        const element = document.elementFromPoint(payload.position.x / scale, payload.position.y / scale)
        if (element === null || element.closest(".file-workspace-tree") === null) return
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
      void listener.then(stop => stop()).catch(report)
    }
  }, [workspace, visible])
  const context = useMemo(() => ({ visible, toggle, openFile }), [visible, toggle, openFile])
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
    reload: t("workspace.reload"),
    changed: t("workspace.changed"),
    unsupported: t("workspace.unsupported"),
    openExternal: t("workspace.openExternal"),
    loading: t("workspace.loading"),
    loadFailed: t("workspace.loadFailed"),
    retry: t("workspace.retry")
  }
  return (
    <WorkspaceContext.Provider value={context}>
      {headerTarget !== null &&
        createPortal(
          <div className="file-workspace-toolbar">
            {visible && workspace && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("workspace.editorSettings")}
                title={t("workspace.editorSettings")}
                onClick={() => setSettingsOpen(true)}>
                <Settings2 />
              </Button>
            )}
            {visible && workspace && (
              <Button
                variant="ghost"
                size="icon"
                className="workspace-view-toggle"
                aria-label={t(viewMode ? "workspace.exitViewMode" : "workspace.enterViewMode")}
                title={t(viewMode ? "workspace.exitViewMode" : "workspace.enterViewMode")}
                aria-pressed={viewMode}
                onClick={() => setViewMode(value => !value)}>
                {viewMode ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
            <WorkspaceButton />
          </div>,
          headerTarget
        )}
      <div
        ref={container}
        className="file-workspace-layout"
        data-open={visible}
        data-view-mode={visible && workspace !== null && viewMode}>
        <div className="file-workspace-chat">{children}</div>
        {visible && workspace && (
          <>
            <hr
              tabIndex={0}
              aria-label={t("workspace.resize")}
              aria-orientation="vertical"
              aria-valuenow={width}
              aria-valuemin={30}
              aria-valuemax={80}
              className="file-workspace-resize"
              onKeyDown={event => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault()
                  setWidth(value => Math.min(80, Math.max(30, value + (event.key === "ArrowLeft" ? 2 : -2))))
                }
              }}
              onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
              onPointerMove={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId) && container.current) {
                  const bounds = container.current.getBoundingClientRect()
                  setWidth(Math.min(80, Math.max(30, ((bounds.right - event.clientX) / bounds.width) * 100)))
                }
              }}
              onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}
            />
            <aside
              id="file-workspace-panel"
              className="file-workspace-panel"
              style={{ "--workspace-width": `${width}%` } as CSSProperties}
              aria-label={t("workspace.files")}>
              <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1">
                  <ChatDirectoryContext.Provider value={workspace.root}>
                    <EditorWorkbench
                      controller={workspace.editor}
                      labels={editorLabels}
                      compactToolbar
                      rootPath={workspace.root}
                      onRevealPath={path => workspace.tree.reveal(path)}
                      onReveal={document => revealItemsInDir(document.path)}
                      onCopyPath={document => navigator.clipboard.writeText(document.path)}
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
                      onOpenExternal={document => openExternal(document.path)}
                      previews={previews}
                      requestSaveAs={async document =>
                        ask({
                          title: t("workspace.saveAs"),
                          detail: workspace.root,
                          initial: document.path,
                          choices: [{ label: t("workspace.save"), value: "save" }]
                        })
                      }
                      renderTextEditor={props => (
                        <Suspense
                          fallback={<div className="text-muted-foreground p-6 text-sm">{t("workspace.loading")}</div>}>
                          <CodeEditor {...props} controller={workspace.editor} settings={settings} onError={report} />
                        </Suspense>
                      )}
                    />
                  </ChatDirectoryContext.Provider>
                </div>
                <div className="file-workspace-tree" data-collapsed={!treeVisible}>
                  <FileTree
                    controller={workspace.tree}
                    collapsed={!treeVisible}
                    explorerControl={
                      <Button
                        className="workspace-explorer-toggle"
                        aria-label={t(treeVisible ? "workspace.hideTree" : "workspace.showTree")}
                        title={t(treeVisible ? "workspace.hideTree" : "workspace.showTree")}
                        aria-expanded={treeVisible}
                        onClick={() => setTreeVisible(value => !value)}>
                        <FolderTree />
                      </Button>
                    }
                    isDark={resolvedTheme === "dark"}
                    iconTheme={workspace.iconTheme}
                    activePath={activeDocument ? activeDocument.path : null}
                    labels={treeLabels}
                    onError={report}
                    onOpenFile={path => workspace.treeOpener.open(path)}
                    onPinFile={path => workspace.treeOpener.open(path, true)}
                    onOpenExternal={openExternal}
                    onReveal={path => revealItemsInDir(path)}
                    onCopyPath={path => navigator.clipboard.writeText(path)}
                    requestMoveDestination={async () => {
                      const path = await openDialog({
                        directory: true,
                        multiple: false,
                        defaultPath: workspace.root,
                        title: t("workspace.moveTo")
                      })
                      return path
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
                    confirmDelete={async paths =>
                      (await ask({
                        title: t("workspace.remove"),
                        detail: paths.join("\n"),
                        choices: [{ label: t("workspace.remove"), value: "delete" }]
                      })) === "delete"
                    }
                  />
                </div>
              </div>
            </aside>
          </>
        )}
      </div>
      {workspace && (
        <EditorSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onChange={value => {
            setSettings(value)
            try {
              saveEditorSettings(value)
            } catch (error) {
              report(error)
            }
          }}
          iconTheme={workspace.iconTheme}
          onIconThemeChange={workspace.setIconTheme}
        />
      )}
      {dialog}
    </WorkspaceContext.Provider>
  )
}
