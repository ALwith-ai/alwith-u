import type { ThreadSummary } from "@/agent/client"

export const QUICK_CHATS_GROUP = "quick-chats"
export const REVEAL_PAGE_SIZE = 100

/** Codex descendants and temporary workspaces belong to quick chats. */
export function isQuickChatDirectory(cwd: string, windowsTempDirectory: string | null = null): boolean {
  const windowsPath = normalizeWindowsPath(cwd)
  if (/^[a-z]:\//i.test(windowsPath) || windowsPath.startsWith("//")) {
    if (windowsTempDirectory !== null) {
      const root = normalizeWindowsPath(windowsTempDirectory)
      if (windowsPath === root || windowsPath.startsWith(`${root}/`)) return true
    }
    // Recognize historical default paths even when the current user has relocated TEMP.
    return (
      /^[a-z]:\/users\/[^/]+\/documents\/(codex(?:\/.*)?|alwith u)$/.test(windowsPath) ||
      /^[a-z]:\/(?:users\/[^/]+\/appdata\/local\/temp|windows\/temp)(?:\/.*)?$/.test(windowsPath)
    )
  }
  return (
    /^\/(?:private\/)?var\/folders(?:\/|$)/.test(cwd) ||
    /^\/Users\/[^/]+\/Documents\/(Codex(?:\/.*)?|ALwith U)$/.test(cwd.replace(/\/+$/, ""))
  )
}

function normalizeWindowsPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase()
}

export function groupThreads(
  threads: ThreadSummary[],
  windowsTempDirectory: string | null = null
): Array<[string, ThreadSummary[]]> {
  const groups = new Map<string, ThreadSummary[]>([[QUICK_CHATS_GROUP, []]])
  for (const thread of [...threads].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))) {
    const key = isQuickChatDirectory(thread.cwd, windowsTempDirectory) ? QUICK_CHATS_GROUP : thread.cwd
    const group = groups.get(key)
    if (group) group.push(thread)
    else groups.set(key, [thread])
  }
  return [...groups]
}
