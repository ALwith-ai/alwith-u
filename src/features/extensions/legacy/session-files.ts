import type { NativeFileResponse } from "@alwith/module-extension/host"
import type { ThreadSummary } from "@/agent/client"

export interface SessionFileSource {
  list(): Promise<ThreadSummary[]>
  read(id: string): Promise<string>
  check(): void
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
  listSessions(baseDir: string): Promise<LegacySessionEntry[]>
  file(operation: string, relative: string): Promise<NativeFileResponse>
}

/** A virtual, read-only Desktop view of Codex history; no transcript is written or cached. */
export function createSessionFiles(root: string, source: SessionFileSource): SessionFiles {
  const project = (cwd: string): string => cwd.replaceAll("\\", "/").replaceAll("/", "-")
  let snapshot: { threads: ThreadSummary[]; expires: number } | undefined
  let pending: Promise<ThreadSummary[]> | undefined
  const index = async (refresh = false): Promise<ThreadSummary[]> => {
    source.check()
    if (!refresh && snapshot && snapshot.expires > Date.now()) return snapshot.threads
    pending ??= source
      .list()
      .then(threads => {
        // Both directory scanning and list_sessions must reject ambiguous legacy paths.
        const projects = new Map<string, string>()
        for (const thread of threads) {
          const key = project(thread.cwd)
          const previous = projects.get(key)
          if (previous !== undefined && previous !== thread.cwd)
            throw new Error("旧扩展工作目录编码冲突，无法安全关联会话")
          projects.set(key, thread.cwd)
        }
        snapshot = { threads, expires: Date.now() + 30_000 }
        return threads
      })
      .finally(() => {
        pending = undefined
      })
    const threads = await pending
    source.check()
    return threads
  }
  const name = (thread: ThreadSummary): string => `${project(thread.cwd)}/${encodeURIComponent(thread.sessionId)}.jsonl`
  return {
    async listSessions(baseDir: string): Promise<LegacySessionEntry[]> {
      if (baseDir !== root && !baseDir.startsWith(`${root}/`)) throw new Error("会话目录必须位于只读历史投影内")
      const suffix = baseDir === root ? "" : baseDir.slice(root.length + 1)
      if (suffix.includes("/") || suffix === "..") throw new Error("无效的会话目录")
      const threads = (await index(true)).filter(thread => !suffix || project(thread.cwd) === suffix)
      return threads.map(thread => ({
        kind: "session",
        id: thread.sessionId,
        title: thread.title,
        project_dir: project(thread.cwd),
        path: `${root}/${name(thread)}`,
        modified_ms: thread.updatedAt === null ? 0 : Date.parse(thread.updatedAt)
      }))
    },
    async file(operation: string, relative: string): Promise<NativeFileResponse> {
      source.check()
      if (!["read", "stat", "list"].includes(operation)) throw new Error("会话历史投影是只读的")
      const threads = await index(relative === "")
      const parts = relative ? relative.split("/") : []
      if (parts.length <= 1) {
        if (operation === "read") throw new Error("不能读取会话目录正文")
        // An empty project directory must exist to prevent the legacy caller falling back to all projects.
        if (operation === "stat")
          return { type: "stat", exists: true, size: 0, mtime: null, isFile: false, isDirectory: true }
        const entries =
          parts.length === 0
            ? [...new Set(threads.map(thread => project(thread.cwd)))].map(name => ({
                name,
                isDirectory: true,
                isFile: false
              }))
            : threads
                .filter(thread => project(thread.cwd) === relative)
                .map(thread => ({
                  name: `${encodeURIComponent(thread.sessionId)}.jsonl`,
                  isDirectory: false,
                  isFile: true
                }))
        return { type: "list", entries }
      }
      const thread = threads.find(thread => name(thread) === relative)
      if (!thread || operation === "list") throw new Error("会话文件不存在")
      const text = await source.read(thread.sessionId)
      source.check()
      const body = new TextEncoder().encode(text)
      // A null mtime prevents the legacy extension's size/mtime shortcut hiding same-second edits.
      return operation === "stat"
        ? { type: "stat", exists: true, size: body.length, mtime: null, isFile: true, isDirectory: false }
        : { type: "read", body: Array.from(body) }
    }
  }
}
