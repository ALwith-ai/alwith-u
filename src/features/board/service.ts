import { commands as fsCommands } from "@alwith/module-fs/commands"
import { createTauriAdapter } from "@alwith/module-fs/tauri"

import type { BoardService } from "@/agent/board-tools"

import { BOARD_FILE, type BoardStore, createBoardStore } from "./store"

const stores = new Map<string, Promise<BoardStore>>()
/** The canvas file each project is showing; conversations work on the one the person sees. */
const shown = new Map<string, string>()

/** The canvas and every conversation in a project share one store per file, so each sees the other's edits. */
function boardStore(cwd: string, file = shown.get(cwd) ?? BOARD_FILE): Promise<BoardStore> {
  const key = `${cwd}\n${file}`
  let store = stores.get(key)
  if (!store) {
    store = fsCommands
      .workspaceOpen({ path: cwd })
      .then((root) => createBoardStore(root, createTauriAdapter({ root, watch: false }), file))
    store.catch(() => stores.delete(key))
    stores.set(key, store)
  }
  return store
}

/** Show a project-relative canvas file as the project's board. */
export function showBoard(cwd: string, file: string): Promise<BoardStore> {
  shown.set(cwd, file)
  return boardStore(cwd, file)
}

export function boardService(cwd: string): BoardService {
  return {
    read: async () => (await boardStore(cwd)).read(),
    update: async (change) => (await boardStore(cwd)).update(change)
  }
}
