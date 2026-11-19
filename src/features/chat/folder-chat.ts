import { macProjectPaths, type SessionSummary } from "@alwith/module-chat/client"
import { normalizePath } from "@alwith/module-fs"

import { isMac } from "@/lib/platform"
import { openStore } from "@/lib/store"

export type FolderChatTarget = { cwd: string; path: string }

// Workspace routing preferences reference Codex IDs. The adapter still supplies every session and its history.
const folders = openStore("chat-folder-preferences")

function canonicalPath(path: string): string {
  const key = normalizePath(path)
  return isMac() ? macProjectPaths(key)[0] : key
}

function pathKey(path: string): string {
  const key = canonicalPath(path)
  return /^(?:[a-z]:\/|\/\/)/i.test(key) ? key.toLowerCase() : key
}

export function sameChatDirectory(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

function folderKey({ cwd, path }: FolderChatTarget): string {
  const root = pathKey(cwd)
  const target = pathKey(path)
  if (target === root) return ""
  const prefix = root.endsWith("/") ? root : `${root}/`
  if (!target.startsWith(prefix)) throw new Error("Chat folder is outside its project")
  return canonicalPath(path).slice(prefix.length)
}

export async function saveChatFolder(sessionId: string, target: FolderChatTarget): Promise<void> {
  const folder = folderKey(target)
  if (folder !== "") await folders.set(sessionId, folder)
}

export async function deleteChatFolder(sessionId: string): Promise<void> {
  await folders.delete(sessionId)
}

export async function readChatFolders(): Promise<ReadonlyMap<string, string>> {
  return new Map(await folders.entries<string>())
}

export function matchesChatFolder(
  target: FolderChatTarget,
  session: Pick<SessionSummary, "cwd" | "sessionId">,
  preferences: ReadonlyMap<string, string>
): boolean {
  if (!sameChatDirectory(session.cwd, target.cwd)) return false
  return sameChatDirectory(chatFolderPath(session.cwd, preferences.get(session.sessionId)), target.path)
}

function chatFolderPath(cwd: string, folder: string | undefined): string {
  if (folder === undefined) return cwd
  return normalizePath(`${normalizePath(cwd).replace(/\/$/, "")}/${folder}`)
}

export function latestFolderChat(
  target: FolderChatTarget,
  sessions: readonly SessionSummary[],
  preferences: ReadonlyMap<string, string>
): SessionSummary | undefined {
  return sessions
    .filter((session) => matchesChatFolder(target, session, preferences))
    .toSorted((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0]
}
