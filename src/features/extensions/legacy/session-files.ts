import type { NativeFileResponse } from "@alwith/module-extension/host"

import type { SessionSummary } from "@/agent/client"

export interface SessionFileSource {
  list: () => Promise<SessionSummary[]>
  read: (id: string) => Promise<string>
  check: () => void
}

interface LegacySessionEntry {
  kind: "session"
  id: string
  title: string | null
  project_dir: string
  path: string
  modified_ms: number
}

interface SessionFiles {
  listSessions: (baseDir: string) => Promise<LegacySessionEntry[]>
  file: (operation: string, relative: string) => Promise<NativeFileResponse>
}

/** A virtual, read-only Desktop view of Codex history; no transcript is written or cached. */
export function createSessionFiles(root: string, source: SessionFileSource): SessionFiles {
  const project = (cwd: string): string => cwd.replaceAll("\\", "/").replaceAll("/", "-")
  let snapshot: { sessionRows: SessionSummary[]; expires: number } | undefined
  let pending: Promise<SessionSummary[]> | undefined
  const index = async (refresh = false): Promise<SessionSummary[]> => {
    source.check()
    if (!refresh && snapshot && snapshot.expires > Date.now()) return snapshot.sessionRows
    pending ??= source
      .list()
      .then((sessionRows) => {
        // Both directory scanning and list_sessions must reject ambiguous legacy paths.
        const projects = new Map<string, string>()
        for (const sessionRow of sessionRows) {
          const key = project(sessionRow.cwd)
          const previous = projects.get(key)
          if (previous !== undefined && previous !== sessionRow.cwd)
            throw new Error("旧扩展工作目录编码冲突，无法安全关联会话")
          projects.set(key, sessionRow.cwd)
        }
        snapshot = { sessionRows, expires: Date.now() + 30_000 }
        return sessionRows
      })
      .finally(() => {
        pending = undefined
      })
    const sessionRows = await pending
    source.check()
    return sessionRows
  }
  const name = (sessionRow: SessionSummary): string => `${project(sessionRow.cwd)}/${encodeURIComponent(sessionRow.sessionId)}.jsonl`
  return {
    async listSessions(baseDir: string): Promise<LegacySessionEntry[]> {
      if (baseDir !== root && !baseDir.startsWith(`${root}/`)) throw new Error("会话目录必须位于只读历史投影内")
      const suffix = baseDir === root ? "" : baseDir.slice(root.length + 1)
      if (suffix.includes("/") || suffix === "..") throw new Error("无效的会话目录")
      const sessionRows = (await index(true)).filter((sessionRow) => !suffix || project(sessionRow.cwd) === suffix)
      return sessionRows.map((sessionRow) => ({
        kind: "session",
        id: sessionRow.sessionId,
        title: sessionRow.title,
        project_dir: project(sessionRow.cwd),
        path: `${root}/${name(sessionRow)}`,
        modified_ms: sessionRow.updatedAt === null ? 0 : Date.parse(sessionRow.updatedAt)
      }))
    },
    async file(operation: string, relative: string): Promise<NativeFileResponse> {
      source.check()
      if (!["read", "stat", "list"].includes(operation)) throw new Error("会话历史投影是只读的")
      const sessionRows = await index(relative === "")
      const parts = relative ? relative.split("/") : []
      if (parts.length <= 1) {
        if (operation === "read") throw new Error("不能读取会话目录正文")
        // An empty project directory must exist to prevent the legacy caller falling back to all projects.
        if (operation === "stat")
          return { type: "stat", exists: true, size: 0, mtime: null, isFile: false, isDirectory: true }
        const entries =
          parts.length === 0
            ? [...new Set(sessionRows.map((sessionRow) => project(sessionRow.cwd)))].map((name) => ({
                name,
                isDirectory: true,
                isFile: false
              }))
            : sessionRows
                .filter((sessionRow) => project(sessionRow.cwd) === relative)
                .map((sessionRow) => ({
                  name: `${encodeURIComponent(sessionRow.sessionId)}.jsonl`,
                  isDirectory: false,
                  isFile: true
                }))
        return { type: "list", entries }
      }
      const sessionRow = sessionRows.find((sessionRow) => name(sessionRow) === relative)
      if (!sessionRow || operation === "list") throw new Error("会话文件不存在")
      const text = await source.read(sessionRow.sessionId)
      source.check()
      const body = new TextEncoder().encode(text)
      // A null mtime prevents the legacy extension's size/mtime shortcut hiding same-second edits.
      return operation === "stat"
        ? { type: "stat", exists: true, size: body.length, mtime: null, isFile: true, isDirectory: false }
        : { type: "read", body: [...body] }
    }
  }
}
