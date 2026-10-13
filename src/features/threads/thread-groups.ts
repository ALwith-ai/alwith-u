import type { ThreadSummary } from "@/agent/client"

export const QUICK_CHATS_GROUP = "quick-chats"
export const REVEAL_PAGE_SIZE = 100

/** Codex descendants and the ALwith U workspace belong to quick chats. */
export function isQuickChatDirectory(cwd: string): boolean {
  const windowsPath = normalizeWindowsPath(cwd)
  if (/^[a-z]:\//i.test(windowsPath) || windowsPath.startsWith("//")) {
    return /^[a-z]:\/users\/[^/]+\/documents\/(codex(?:\/.*)?|alwith u)$/.test(windowsPath)
  }
  return /^\/Users\/[^/]+\/Documents\/(Codex(?:\/.*)?|ALwith U)$/.test(cwd.replace(/\/+$/, ""))
}

function normalizeWindowsPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase()
}

export function groupThreads(threads: ThreadSummary[]): Array<[string, ThreadSummary[]]> {
  const groups = new Map<string, ThreadSummary[]>([[QUICK_CHATS_GROUP, []]])
  for (const thread of [...threads].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))) {
    const key = isQuickChatDirectory(thread.cwd) ? QUICK_CHATS_GROUP : thread.cwd
    const group = groups.get(key)
    if (group) group.push(thread)
    else groups.set(key, [thread])
  }
  return [...groups]
}
