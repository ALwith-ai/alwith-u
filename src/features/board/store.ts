import { dirname, type FsAdapter, normalizePath } from "@alwith/module-fs/core"
import { type CanvasDocument, emptyCanvas, parseCanvas, serializeCanvas } from "@nyssance/metro"

import type { BoardService } from "@/agent/board-tools"

/** The board a project has until another canvas file of it is opened, at its root where other applications find it. */
export const BOARD_FILE = "board.canvas"

export interface BoardStore extends BoardService {
  /** The project directory the board's paths are relative to. */
  root: string
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => CanvasDocument | null
  /** Selection is what the person points at now; it is never written to the project. */
  select: (ids: readonly string[]) => void
  /** A project file a card shows, or null when it is gone. */
  file: (relative: string) => Promise<Uint8Array | null>
}
type BoardFiles = Pick<FsAdapter, "stat" | "readFile" | "writeFile" | "createDirectory">

/**
 * One project's board file. The file is the source of truth: every read loads it again, so edits
 * made by a conversation, the canvas, or another tool are all seen, and writes run one at a time.
 */
export function createBoardStore(root: string, files: BoardFiles, file = BOARD_FILE): BoardStore {
  const within = (relative: string) => normalizePath(`${root}/${relative}`)
  const path = within(file)
  const listeners = new Set<() => void>()
  let snapshot: CanvasDocument | null = null
  let selected: readonly string[] = []
  let serialized: string | null = null
  let queue: Promise<unknown> = Promise.resolve()

  async function load(): Promise<CanvasDocument> {
    const text = (await files.stat(path)) ? new TextDecoder().decode(await files.readFile(path)) : null
    // An unchanged file keeps its snapshot, so a refresh does not re-render the canvas.
    if (snapshot === null || text !== serialized) {
      snapshot = text === null ? emptyCanvas() : parseCanvas(text)
      serialized = text
      for (const listener of listeners) listener()
    }
    return snapshot
  }
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    root,
    read: () =>
      serial(async () => {
        const board = await load()
        return { board, selected: selected.filter((id) => board.nodes.some((node) => node.id === id)) }
      }),
    update: (change) =>
      serial(async () => {
        const next = change(await load())
        if (!(await files.stat(dirname(path)))) await files.createDirectory(dirname(path))
        await files.writeFile(path, new TextEncoder().encode(serializeCanvas(next)), { mode: "upsert" })
        await load()
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    select(ids) {
      selected = ids
    },
    async file(relative) {
      const target = within(relative)
      return (await files.stat(target))?.kind === "file" ? files.readFile(target) : null
    }
  }
}
