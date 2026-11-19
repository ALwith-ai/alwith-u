import { CodexMarkdownRenderer, type MarkdownHost } from "@alwith/module-chat/markdown"
import { containsPath, normalizePath } from "@alwith/module-fs/core"
import {
  type CanvasContent,
  type CanvasDocument,
  type CanvasNode,
  type CanvasSide,
  colorNode,
  connect,
  copyNodes,
  disconnect,
  fileSection,
  findNodes,
  frameNode,
  groupNodes,
  nodesInside,
  parseCanvas,
  pasteNodes,
  putNode,
  removeNode,
  serializeCanvas
} from "@nyssance/metro"
import { isTextInput, WorkCanvas } from "@nyssance/metro/canvas"
import { useTidyLayout, useZoomShortcuts } from "@nyssance/metro/controls"
import { createHistory } from "@nyssance/metro/history"
import { type SnapGuide, SnapGuides, snapNodeChanges } from "@nyssance/metro/snap"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { readText } from "@tauri-apps/plugin-clipboard-manager"
import {
  ConnectionMode,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  NodeResizer,
  Position,
  ReactFlowProvider,
  useReactFlow
} from "@xyflow/react"
import {
  BanIcon,
  ExternalLinkIcon,
  GroupIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  Redo2Icon,
  StickyNoteIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon
} from "lucide-react"
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/features/workspace/context"
import { copyText } from "@/lib/clipboard"
import { openExternal } from "@/lib/open"
import { text } from "@/lib/text"

import { showBoard } from "./service"
import { BOARD_FILE, type BoardStore } from "./store"
import "@nyssance/metro/presets/flow.css"
import "./board-pane.css"

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml"
}
const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg"
}
const TEXT_TYPES =
  /^(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|log|sql|html?|css|[cm]?[jt]sx?|py|rs|go|java|kt|swift|sh|xml)$/
/** A card previews the start of a text file; the whole file opens in the editor. */
const PREVIEW_CHARACTERS = 4000
/** The format's six preset colours, in its order: red, orange, yellow, green, cyan, purple. */
const PRESETS = ["1", "2", "3", "4", "5", "6"] as const
const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

type Frame = Pick<CanvasNode, "x" | "y" | "width" | "height">
interface CardActions {
  open: (node: CanvasNode) => void
  openLink: (url: string) => void
  change: (id: string, content: CanvasContent) => void
  resize: (id: string, frame: Frame) => void
}
type CardNode = Node<{ node: CanvasNode }, "card">

const BoardContext = createContext<{ store: BoardStore; actions: CardActions } | null>(null)

function report(error: unknown): void {
  toast.error(text(error))
}

function extension(path: string): string {
  return path.split(".").at(-1)?.toLowerCase() ?? ""
}

/** A preset is styled by the stylesheet; a hex colour from the file is passed through as it is. */
function colorProps(color: unknown): { "data-color"?: string; style?: CSSProperties } {
  if (typeof color !== "string") return {}
  return color.startsWith("#") ? { style: { "--board-color": color } as CSSProperties } : { "data-color": color }
}

function Markdown({ source }: { source: string }): ReactNode {
  const board = useContext(BoardContext)
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const copyLabel = t("actions.copy")
  const openLink = board?.actions.openLink
  const host = useMemo<MarkdownHost>(
    () => ({ theme: resolvedTheme, copyLabel, copyText, onCopyError: report, openLink: (url) => openLink?.(url) }),
    [resolvedTheme, copyLabel, openLink]
  )
  return <CodexMarkdownRenderer text={source} host={host} />
}

/** The file a card stands for, shown as itself: an image as the image, text as the part it points at. */
function FileContent({ path, subpath }: { path: string; subpath?: string }): ReactNode {
  const store = useContext(BoardContext)?.store
  const [content, setContent] = useState<{ image: string } | { media: string; type: string } | { text: string } | null>(
    null
  )
  useEffect(() => {
    const image = IMAGE_TYPES[extension(path)]
    const media = MEDIA_TYPES[extension(path)]
    if (!store || (!image && !media && !TEXT_TYPES.test(extension(path)))) return
    let url: string | undefined
    let disposed = false
    void store
      .file(path)
      .then((bytes) => {
        if (disposed || !bytes) return
        if (image ?? media) {
          url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: image ?? media }))
          setContent(image ? { image: url } : { media: url, type: media })
        } else setContent({ text: fileSection(new TextDecoder().decode(bytes), subpath).slice(0, PREVIEW_CHARACTERS) })
      })
      .catch(report)
    return () => {
      disposed = true
      setContent(null)
      if (url) URL.revokeObjectURL(url)
    }
  }, [store, path, subpath])
  if (!content) return null
  if ("image" in content) return <img className="board-card-image" src={content.image} alt={path} draggable={false} />
  if ("media" in content)
    return content.type.startsWith("video") ? (
      // Playing and scrubbing belong to the player, not to the canvas underneath.
      <video className="board-card-image nodrag nowheel" src={content.media} controls preload="metadata" />
    ) : (
      <audio className="nodrag" src={content.media} controls preload="metadata" />
    )
  return /^(md|markdown)$/.test(extension(path)) ? (
    <div className="board-card-text">
      <Markdown source={content.text} />
    </div>
  ) : (
    <pre className="board-card-file">{content.text}</pre>
  )
}

/** Markdown that turns into its own editor on a double click and saves when focus leaves. */
function TextContent({ node }: { node: Extract<CanvasNode, { type: "text" }> }): ReactNode {
  const actions = useContext(BoardContext)?.actions
  const { t } = useTranslation()
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null)
    return (
      <div className="board-card-text" onDoubleClick={() => setDraft(node.text)}>
        <Markdown source={node.text} />
      </div>
    )
  return (
    <textarea
      // Typing, selecting and scrolling belong to the editor, not to the canvas underneath.
      className="board-card-editor nodrag nowheel nopan"
      aria-label={t("board.text")}
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") setDraft(null)
      }}
      onBlur={() => {
        if (draft !== node.text) actions?.change(node.id, { type: "text", text: draft })
        setDraft(null)
      }}
    />
  )
}

function CardView({ data, selected }: NodeProps<CardNode>): ReactNode {
  const { node } = data
  const actions = useContext(BoardContext)?.actions
  return (
    <div
      className="board-card"
      data-selected={selected}
      data-type={node.type}
      data-board-card={node.id}
      {...colorProps(node.color)}
      onDoubleClick={node.type === "file" || node.type === "link" ? () => actions?.open(node) : undefined}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={48}
        onResizeEnd={(_event, frame) => actions?.resize(node.id, frame)}
      />
      {Object.entries(SIDES).map(([side, position]) => (
        <Handle key={side} id={side} type="source" position={position} />
      ))}
      {node.type === "text" && <TextContent node={node} />}
      {node.type === "group" && node.label && <div className="board-card-title">{node.label}</div>}
      {node.type === "link" && (
        <>
          <div className="board-card-title">{new URL(node.url).host}</div>
          <p className="board-card-source">{node.url}</p>
        </>
      )}
      {node.type === "file" && (
        <>
          <div className="board-card-title">
            {node.file.split("/").at(-1)}
            {node.subpath}
          </div>
          <FileContent path={node.file} subpath={node.subpath} />
        </>
      )}
    </div>
  )
}
const nodeTypes = { card: CardView }

function Field({
  label,
  value,
  onCommit
}: {
  label: string
  value: string
  onCommit: (value: string) => void
}): ReactNode {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Input
      aria-label={label}
      placeholder={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  )
}

function NodeInspector({
  node,
  onChange,
  onColor,
  onOpen,
  onRemove
}: {
  node: CanvasNode
  onChange: (content: CanvasContent) => void
  onColor: (color: string | undefined) => void
  onOpen: () => void
  onRemove: () => void
}): ReactNode {
  const { t } = useTranslation()
  const opens = node.type === "file" || node.type === "link"
  return (
    <aside className="board-inspector" aria-label={t("board.card")}>
      {node.type === "text" && (
        <Textarea
          key={node.text}
          aria-label={t("board.text")}
          placeholder={t("board.text")}
          defaultValue={node.text}
          onBlur={(event) => event.target.value !== node.text && onChange({ type: "text", text: event.target.value })}
        />
      )}
      {node.type === "link" && (
        <Field
          label={t("board.url")}
          value={node.url}
          onCommit={(url) => onChange({ type: "link", url: url.trim() })}
        />
      )}
      {node.type === "group" && (
        <Field
          label={t("board.label")}
          value={node.label ?? ""}
          onCommit={(label) => onChange(label ? { type: "group", label } : { type: "group" })}
        />
      )}
      {node.type === "file" && (
        <>
          <Field
            label={t("board.file")}
            value={node.file}
            onCommit={(file) =>
              onChange({ type: "file", file: file.trim(), ...(node.subpath ? { subpath: node.subpath } : {}) })
            }
          />
          <Field
            label={t("board.subpath")}
            value={node.subpath ?? ""}
            onCommit={(subpath) =>
              onChange({ type: "file", file: node.file, ...(subpath.trim() ? { subpath: subpath.trim() } : {}) })
            }
          />
        </>
      )}
      <div className="board-inspector-actions">
        <div className="board-swatches" role="group" aria-label={t("board.color")}>
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="board-swatch"
              data-color={preset}
              aria-label={`${t("board.color")} ${preset}`}
              aria-pressed={node.color === preset}
              onClick={() => onColor(preset)}
            />
          ))}
          <Button size="icon-xs" variant="ghost" aria-label={t("board.noColor")} onClick={() => onColor(undefined)}>
            <BanIcon />
          </Button>
        </div>
        {opens && (
          <Button size="sm" variant="outline" className="ms-auto" onClick={onOpen}>
            <ExternalLinkIcon />
            {t("board.openSource")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className={opens ? undefined : "ms-auto"}
          aria-label={t("board.remove")}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
    </aside>
  )
}

function Canvas({
  store,
  name,
  sessionId,
  onClose
}: {
  store: BoardStore
  /** The canvas file's name, when it is not the project's own board. */
  name?: string
  sessionId: string | null
  onClose: () => void
}): ReactNode {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const flow = useReactFlow()
  const workspace = useWorkspace()
  const board = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [nodes, setNodes] = useState<CardNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const hovered = useRef(false)
  /** Cards to select once the board shows them: what was just pasted or duplicated. */
  const selectNext = useRef<string[] | null>(null)
  /** Where the context menu was opened, in canvas coordinates. */
  const menuAt = useRef<{ x: number; y: number } | undefined>(undefined)
  /** While a group is dragged, where it started and where each node inside it started. */
  const carried = useRef<{ group: { x: number; y: number }; nodes: Map<string, { x: number; y: number }> } | null>(null)
  useEffect(() => {
    const refresh = (): void => void store.read().catch(report)
    refresh()
    window.addEventListener("focus", refresh)
    return () => window.removeEventListener("focus", refresh)
  }, [store])

  const [guides, setGuides] = useState<SnapGuide[]>([])
  // Every change a person makes here is a step back; what a conversation writes is not one of theirs.
  const history = useMemo(
    () =>
      createHistory<{ canvas: CanvasDocument | null }>({
        read: () => ({ canvas: store.getSnapshot() }),
        write: ({ canvas }) => {
          if (canvas) void store.update(() => canvas).catch(report)
        }
      }),
    [store]
  )
  const update = (change: (board: CanvasDocument) => CanvasDocument): void => {
    history.captureUndo()
    void store.update(change).catch(report)
  }
  /** Where each node sits inside the group that contains it, which is how the layout wants them. */
  const grouped = () => {
    const current = store.getSnapshot() ?? { nodes: [], edges: [] }
    const parents = new Map<string, CanvasNode>()
    for (const group of current.nodes)
      if (group.type === "group")
        for (const id of nodesInside(current as CanvasDocument, group.id)) parents.set(id, group)
    return { current, parents }
  }
  // Lay everything out along its links; what sits inside a group moves with the group.
  const { tidy } = useTidyLayout({
    confirm: false,
    nodes: () => {
      const { current, parents } = grouped()
      return current.nodes.map((entry) => {
        const parent = parents.get(entry.id)
        return {
          id: entry.id,
          ...(parent ? { parentId: parent.id } : {}),
          position: { x: entry.x - (parent?.x ?? 0), y: entry.y - (parent?.y ?? 0) },
          size: { w: entry.width, h: entry.height }
        }
      })
    },
    edges: () => (store.getSnapshot()?.edges ?? []).map((entry) => ({ source: entry.fromNode, target: entry.toNode })),
    move: (positions) => {
      const { current, parents } = grouped()
      update((next) => {
        for (const entry of current.nodes) {
          const parent = parents.get(entry.id)
          const moved = parent && positions[parent.id]
          if (positions[entry.id]) next = frameNode(next, entry.id, positions[entry.id])
          else if (parent && moved)
            next = frameNode(next, entry.id, { x: entry.x + moved.x - parent.x, y: entry.y + moved.y - parent.y })
        }
        return next
      })
    },
    onError: report
  })
  useZoomShortcuts()
  const openLink = (url: string): void => {
    void (
      sessionId ? invoke("cef_browser_open_url", { sessionId, url }).catch(() => openExternal(url)) : openExternal(url)
    ).catch(report)
  }
  const open = (node: CanvasNode): void => {
    if (node.type === "link") openLink(node.url)
    else if (node.type === "file") void workspace?.openFile(`${store.root}/${node.file}`, store.root).catch(report)
  }
  const put = (clip: Pick<CanvasDocument, "nodes" | "edges">, position?: { x: number; y: number }): void =>
    update((next) => {
      const pasted = pasteNodes(next, clip, () => crypto.randomUUID(), position)
      selectNext.current = pasted.ids
      return pasted.canvas
    })
  /** Pin whatever was brought in: copied cards as cards, addresses as link cards, anything else a note. */
  const pin = (content: string, position?: { x: number; y: number }): void => {
    const value = content.trim()
    if (!value) return
    try {
      const clip = parseCanvas(value)
      if (clip.nodes.length) return put(clip, position)
    } catch {
      // Not a canvas: plain text.
    }
    const urls = value.split(/\s+/)
    const links = urls.every((url) => /^https?:\/\//i.test(url) && URL.canParse(url))
    update((next) =>
      links
        ? urls.reduce(
            (current, url, index) =>
              putNode(
                current,
                crypto.randomUUID(),
                { type: "link", url },
                position && { x: position.x + index * 24, y: position.y + index * 24 }
              ),
            next
          )
        : putNode(next, crypto.randomUUID(), { type: "text", text: value }, position)
    )
  }
  const selection = (): string[] => nodes.filter((entry) => entry.selected).map((entry) => entry.id)
  /** Copied cards travel as a canvas document, so they paste into any board or canvas application. */
  const copy = (): void => {
    const current = store.getSnapshot()
    const clip = current && copyNodes(current, selection())
    if (clip?.nodes.length) void copyText(serializeCanvas({ ...clip })).catch(report)
  }
  const duplicate = (): void => {
    const current = store.getSnapshot()
    if (current && selection().length) put(copyNodes(current, selection()))
  }
  const group = (): void => {
    const ids = selection()
    if (ids.length) update((next) => groupNodes(next, ids, crypto.randomUUID()))
  }
  const remove = (): void => {
    const ids = selection()
    update((next) => ids.reduce((current, id) => removeNode(current, id), next))
  }
  const paste = (position?: { x: number; y: number }): void =>
    void (isTauri() ? readText() : navigator.clipboard.readText())
      .then((content) => pin(content, position))
      .catch(report)
  const live = useRef({ update, pin, open, openLink, history, copy, duplicate, group })
  live.current = { update, pin, open, openLink, history, copy, duplicate, group }
  const actions = useMemo<CardActions>(
    () => ({
      open: (node) => live.current.open(node),
      openLink: (url) => live.current.openLink(url),
      change: (id, content) => live.current.update((current) => putNode(current, id, content)),
      resize: (id, frame) => live.current.update((current) => frameNode(current, id, frame))
    }),
    []
  )
  const context = useMemo(() => ({ store, actions }), [store, actions])

  useEffect(() => {
    if (!board) return
    setNodes((previous) => {
      const selected = new Set(selectNext.current ?? previous.filter((node) => node.selected).map((node) => node.id))
      selectNext.current = null
      return board.nodes.map((node) => ({
        id: node.id,
        type: "card" as const,
        position: { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
        selected: selected.has(node.id),
        data: { node }
      }))
    })
    setEdges((previous) => {
      const selected = new Set(previous.filter((edge) => edge.selected).map((edge) => edge.id))
      return board.edges.map((edge) => ({
        id: edge.id,
        source: edge.fromNode,
        target: edge.toNode,
        sourceHandle: typeof edge.fromSide === "string" ? edge.fromSide : "right",
        targetHandle: typeof edge.toSide === "string" ? edge.toSide : "left",
        label: edge.label,
        // The format draws an arrowhead at the end unless told otherwise, and none at the start.
        ...(edge.toEnd === "none" ? {} : { markerEnd: { type: MarkerType.ArrowClosed } }),
        ...(edge.fromEnd === "arrow" ? { markerStart: { type: MarkerType.ArrowClosed } } : {}),
        ...(typeof edge.color === "string"
          ? edge.color.startsWith("#")
            ? { style: { stroke: edge.color } }
            : { className: `board-edge-${edge.color}` }
          : {}),
        selected: selected.has(edge.id)
      }))
    })
  }, [board])
  const selectedCards = useMemo(() => nodes.filter((node) => node.selected).map((node) => node.id), [nodes])
  useEffect(() => store.select(selectedCards), [store, selectedCards])

  useEffect(() => {
    // Pasting over the board pins the clipboard text; fields keep their own paste.
    const paste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null
      const pasted = event.clipboardData?.getData("text/plain")
      if (!hovered.current || !pasted?.trim() || target?.closest("input, textarea, [contenteditable]")) return
      event.preventDefault()
      live.current.pin(pasted)
    }
    // Undo and redo answer while the pointer is over the board and no field is being typed in.
    const keys = (event: KeyboardEvent): void => {
      if (!hovered.current || isTextInput(event.target) || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === "z") {
        event.preventDefault()
        if (event.shiftKey) live.current.history.redo()
        else live.current.history.undo()
      } else if (key === "c") live.current.copy()
      else if (key === "d") {
        event.preventDefault()
        live.current.duplicate()
      } else if (key === "g") {
        event.preventDefault()
        live.current.group()
      } else if (key === "a") {
        event.preventDefault()
        setNodes((current) => current.map((entry) => ({ ...entry, selected: true })))
      }
    }
    document.addEventListener("paste", paste)
    document.addEventListener("keydown", keys)
    return () => {
      document.removeEventListener("paste", paste)
      document.removeEventListener("keydown", keys)
    }
  }, [])
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    // Files dragged in from the system land as file cards; ones from outside are copied into the project first.
    const listener = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return
      const { paths, position } = event.payload
      void (async () => {
        const scale = await getCurrentWindow().scaleFactor()
        const point = { x: position.x / scale, y: position.y / scale }
        if (cancelled || !document.elementFromPoint(point.x, point.y)?.closest(".board-canvas")) return
        const outside = paths.filter((path) => !containsPath(store.root, normalizePath(path)))
        if (outside.length)
          await invoke("workspace_import", { root: store.root, destination: store.root, paths: outside })
        const origin = flow.screenToFlowPosition(point)
        live.current.update((next) =>
          paths.reduce((current, path, index) => {
            const normalized = normalizePath(path)
            const file = containsPath(store.root, normalized)
              ? normalized.slice(store.root.length + 1)
              : normalized.split("/").at(-1)!
            return putNode(
              current,
              crypto.randomUUID(),
              { type: "file", file },
              { x: origin.x + index * 24, y: origin.y + index * 24 }
            )
          }, next)
        )
      })().catch(report)
    })
    return () => {
      cancelled = true
      void listener.then((stop) => stop()).catch(report)
    }
  }, [store, flow])

  if (!board) return null
  const selectedEdges = edges.filter((edge) => edge.selected)
  const node =
    selectedCards.length === 1 && selectedEdges.length === 0
      ? board.nodes.find((entry) => entry.id === selectedCards[0])
      : undefined
  const edge =
    selectedCards.length === 0 && selectedEdges.length === 1
      ? board.edges.find((entry) => entry.id === selectedEdges[0].id)
      : undefined
  return (
    <BoardContext.Provider value={context}>
      <div
        className="board-pane"
        onPointerEnter={() => (hovered.current = true)}
        onPointerLeave={() => (hovered.current = false)}
      >
        <header className="board-toolbar">
          <span className="board-toolbar-title">{name ?? t("board.name")}</span>
          <Button size="sm" variant="ghost" onClick={() => pin(t("board.note"))}>
            <StickyNoteIcon />
            {t("board.note")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => update((next) => putNode(next, crypto.randomUUID(), { type: "group" }))}
          >
            <GroupIcon />
            {t("board.group")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void tidy()}>
            <LayoutGridIcon />
            {t("board.tidy")}
          </Button>
          <Input
            className="board-search"
            type="search"
            aria-label={t("board.search")}
            placeholder={t("board.search")}
            onChange={(event) => {
              const found = new Set(findNodes(board, event.target.value))
              setNodes((current) => current.map((entry) => ({ ...entry, selected: found.has(entry.id) })))
            }}
            onKeyDown={(event) => {
              const found = selection()
              if (event.key === "Enter" && found.length)
                void flow.fitView({ nodes: found.map((id) => ({ id })), duration: 300, maxZoom: 1.2 })
            }}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            className="ms-auto"
            aria-label={t("board.undo")}
            onClick={() => history.undo()}
          >
            <Undo2Icon />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={t("board.redo")} onClick={() => history.redo()}>
            <Redo2Icon />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={t("board.close")} onClick={onClose}>
            <XIcon />
          </Button>
        </header>
        <ContextMenu>
          <ContextMenuTrigger
            render={<div className="board-canvas" />}
            onContextMenu={(event) => {
              menuAt.current = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
            }}
            // Text or a link dragged from the conversation beside the board is pinned where it is dropped.
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) event.preventDefault()
            }}
            onDrop={(event) => {
              const dropped = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain")
              if (!dropped.trim()) return
              event.preventDefault()
              pin(
                dropped
                  .split("\n")
                  .filter((line) => !line.startsWith("#"))
                  .join("\n"),
                flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
              )
            }}
          >
            <WorkCanvas<CardNode>
              preset="flow"
              forceColorMode={resolvedTheme === "dark" ? "dark" : "light"}
              connectionMode={ConnectionMode.Loose}
              nodeTypes={nodeTypes}
              nodes={nodes}
              edges={edges}
              proOptions={{ hideAttribution: true }}
              onNodesChange={(changes) => {
                // A dragged card lines up with the edges and centres of the others.
                const dragging = changes.getByType("position").some((change) => change.dragging)
                setGuides(dragging ? snapNodeChanges(nodes, changes) : [])
                setNodes((current) => changes.applyTo(current))
              }}
              onEdgesChange={(changes) => setEdges((current) => changes.applyTo(current))}
              onPaneClick={(event) => {
                if (event.detail === 2)
                  pin(t("board.note"), flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
              }}
              onNodeDragStart={(_event, dragged, moving) => {
                const inside = dragged.data.node.type === "group" ? nodesInside(board, dragged.id) : []
                const moved = new Set(moving.map((entry) => entry.id))
                carried.current = {
                  group: dragged.position,
                  nodes: new Map(
                    nodes
                      .filter((entry) => inside.includes(entry.id) && !moved.has(entry.id))
                      .map((entry) => [entry.id, entry.position])
                  )
                }
              }}
              onNodeDrag={(_event, dragged) => {
                const carry = carried.current
                if (!carry?.nodes.size) return
                const dx = dragged.position.x - carry.group.x
                const dy = dragged.position.y - carry.group.y
                setNodes((current) =>
                  current.map((entry) => {
                    const start = carry.nodes.get(entry.id)
                    return start ? { ...entry, position: { x: start.x + dx, y: start.y + dy } } : entry
                  })
                )
              }}
              onNodeDragStop={(_event, dragged, moved) => {
                const carry = carried.current
                carried.current = null
                const dx = carry ? dragged.position.x - carry.group.x : 0
                const dy = carry ? dragged.position.y - carry.group.y : 0
                update((next) => {
                  for (const entry of moved) next = frameNode(next, entry.id, entry.position)
                  for (const [id, start] of carry?.nodes ?? [])
                    next = frameNode(next, id, { x: start.x + dx, y: start.y + dy })
                  return next
                })
              }}
              onConnect={({ source, target, sourceHandle, targetHandle }) =>
                update((next) =>
                  connect(
                    next,
                    source,
                    target,
                    "",
                    sourceHandle && targetHandle
                      ? { fromSide: sourceHandle as CanvasSide, toSide: targetHandle as CanvasSide }
                      : undefined
                  )
                )
              }
              onEdgesDelete={(removed) =>
                update((next) =>
                  removed.reduce(
                    (current, entry) =>
                      current.edges.some((existing) => existing.id === entry.id)
                        ? disconnect(current, entry.source, entry.target)
                        : current,
                    next
                  )
                )
              }
              onNodesDelete={(removed) =>
                update((next) =>
                  removed.reduce(
                    (current, entry) =>
                      current.nodes.some((existing) => existing.id === entry.id)
                        ? removeNode(current, entry.id)
                        : current,
                    next
                  )
                )
              }
            >
              <SnapGuides guides={guides} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </WorkCanvas>
            {nodes.length === 0 && <p className="board-empty">{t("board.empty")}</p>}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => pin(t("board.note"), menuAt.current)}>{t("board.note")}</ContextMenuItem>
            <ContextMenuItem onClick={() => paste(menuAt.current)}>{t("board.paste")}</ContextMenuItem>
            {selectedCards.length > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={copy}>{t("board.copy")}</ContextMenuItem>
                <ContextMenuItem onClick={duplicate}>{t("board.duplicate")}</ContextMenuItem>
                <ContextMenuItem onClick={group}>{t("board.groupSelected")}</ContextMenuItem>
                <ContextMenuItem variant="destructive" onClick={remove}>
                  {t("board.remove")}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void tidy()}>{t("board.tidy")}</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {node && (
          <NodeInspector
            node={node}
            onChange={(content) => update((current) => putNode(current, node.id, content))}
            onColor={(color) => update((current) => colorNode(current, node.id, color))}
            onOpen={() => open(node)}
            onRemove={() => update((current) => removeNode(current, node.id))}
          />
        )}
        {edge && (
          <aside className="board-inspector board-inspector-actions" aria-label={t("board.link")}>
            <Field
              label={t("board.reason")}
              value={edge.label ?? ""}
              onCommit={(label) => update((current) => connect(current, edge.fromNode, edge.toNode, label))}
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("board.remove")}
              onClick={() => update((current) => disconnect(current, edge.fromNode, edge.toNode))}
            >
              <Trash2Icon />
            </Button>
          </aside>
        )}
      </div>
    </BoardContext.Provider>
  )
}

/** A project's board: everything gathered for the work, laid out side by side and linked by hand. */
export function BoardPane({
  cwd,
  file = BOARD_FILE,
  sessionId,
  onClose
}: {
  cwd: string
  /** The project-relative canvas file to show. */
  file?: string
  sessionId: string | null
  onClose: () => void
}): ReactNode {
  const [store, setStore] = useState<BoardStore | null>(null)
  useEffect(() => {
    let disposed = false
    setStore(null)
    void showBoard(cwd, file)
      .then((next) => {
        if (!disposed) setStore(next)
      })
      .catch(report)
    return () => {
      disposed = true
    }
  }, [cwd, file])
  return (
    store && (
      <ReactFlowProvider>
        <Canvas store={store} name={file === BOARD_FILE ? undefined : file} sessionId={sessionId} onClose={onClose} />
      </ReactFlowProvider>
    )
  )
}

export function BoardMenuItem(): ReactNode {
  const workspace = useWorkspace()
  const { t } = useTranslation()
  if (!workspace?.openPane) return null
  return (
    <DropdownMenuItem className="whitespace-nowrap" onClick={() => workspace.openPane?.("board")}>
      <LayoutDashboardIcon className="size-4 shrink-0 text-muted-foreground" />
      {t("board.name")}
    </DropdownMenuItem>
  )
}
