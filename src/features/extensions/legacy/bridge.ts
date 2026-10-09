import type { Dispose, Json } from "@alwith/module-extension"
import {
  type CapabilityBinding,
  createBinaryFetch,
  createBinaryHttp,
  createScopedFileOperations,
  type NativeFileRequest,
  type NativeFileResponse
} from "@alwith/module-extension/host"
import type { LegacyStorage } from "@alwith/module-extension/legacy"
import { unsupportedLegacyCommand, validateLegacyExport } from "./adapters"

import { createExtensionChatBridge } from "../chat/bridge"
import type { ExtensionChatSession } from "../chat/navigation"

export interface BridgeDependencies {
  binding: CapabilityBinding
  native<T>(command: string, args: Record<string, unknown>): Promise<T>
  session(): ExtensionChatSession | null
  setDraft?(id: string, text: string): Promise<void>
  send(id: string, text: string): Promise<void>
  check(): void
  openView(id: string): void
  notify(message: string, duration?: number): { hide(): void; setMessage(message: string): void }
  language(): string
  openExternal(url: string): Promise<void>
  clipboard(text: string): Promise<void>
  own(dispose: Dispose): Dispose
  primary: boolean
  imported?: boolean
}

interface DirectoryGrant {
  scope: string
  path: string
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("无效的旧扩展调用参数")
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("旧扩展参数必须是字符串")
  return value
}

function normalizedPath(value: string): string {
  const result = value.replaceAll("\\", "/")
  if (result.includes("\0") || result.split("/").includes("..")) throw new Error("扩展文件路径不能越过授权目录")
  const normalized = result
    .split("/")
    .filter(part => part !== ".")
    .join("/")
    .replace(/\/+/g, "/")
  return normalized === "/" ? normalized : normalized.replace(/\/$/, "")
}

/** This bridge translates a finite, reviewed Desktop API surface; native code rechecks every grant. */
export function createLegacyBridge(extensionId: string, dependencies: BridgeDependencies) {
  const imported = dependencies.imported !== false
  const commonOptions = {
    native: dependencies.native,
    commands: {
      file: imported ? "legacy_file" : "extension_file",
      pickDirectory: imported ? "legacy_pick_directory" : "extension_pick_directory",
      directories: imported ? "legacy_directories" : "extension_directories",
      http: imported ? "legacy_http" : "extension_http"
    }
  }
  const files = createScopedFileOperations(dependencies.binding, commonOptions)
  const fetch = createBinaryFetch(createBinaryHttp(dependencies.binding, commonOptions))
  const home = `/__alwith_legacy/${extensionId}`
  const appData = `${home}/app-data`
  const settingsPath = `${appData}/ai.alwith.desktop/settings.json`
  const unavailable = (message: string): never => {
    throw new Error(message)
  }
  const directory = `.alwith/extensions/${extensionId}`
  let storage: LegacyStorage | undefined
  let target: ExtensionChatSession | null = null
  let exportDirectory: DirectoryGrant | null = null
  const exported = new Map<string, string>()
  const native = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    dependencies.check()
    const result = await dependencies.native<T>(command, { extensionId, ...args })
    dependencies.check()
    return result
  }
  const locate = async (raw: string): Promise<{ scope?: string; path: string }> => {
    const path = normalizedPath(raw)
    const virtual = path.startsWith(`${home}/`) ? path.slice(home.length + 1) : path
    if (virtual === ".alwith/projects" || virtual.startsWith(".alwith/projects/")) {
      unavailable("会话归档暂不支持，其他知识库功能可用")
    }
    if (path === appData || path.startsWith(`${appData}/`)) {
      throw new Error("仅支持读取当前 U 工作目录的只读设置投影")
    }
    if (path === home || path.startsWith(`${home}/`) || (!path.startsWith("/") && !path.includes(":"))) {
      const relative = path === home ? "." : path.startsWith(`${home}/`) ? path.slice(home.length + 1) : path
      if (relative === directory) return { path: "." }
      if (relative.startsWith(`${directory}/`)) return { path: relative.slice(directory.length + 1) }
      if (relative === ".alwith" || relative.startsWith(".alwith/"))
        throw new Error("不能访问其他扩展或 Desktop 的私有数据")
      return { path: relative || "." }
    }
    const directories = await files.directories()
    const grant = directories
      .filter(
        item =>
          path === normalizedPath(item.path) ||
          path.startsWith(normalizedPath(item.path) === "/" ? "/" : `${normalizedPath(item.path)}/`)
      )
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (!grant) throw new Error("此目录尚未授权，请在扩展中重新选择目录")
    return { scope: grant.scope, path: path.slice(normalizedPath(grant.path).length).replace(/^\//, "") || "." }
  }
  const file = async (
    operation: string,
    path: string,
    extra: Record<string, unknown> = {}
  ): Promise<NativeFileResponse> => {
    if (normalizedPath(path) === settingsPath) {
      if (operation !== "read" && operation !== "stat") throw new Error("工作目录设置投影是只读的")
      const session = dependencies.session()
      const settings = {
        "window.scopedState": session ? { main: { lastOpenedWorkspace: { path: session.cwd } } } : {},
        recentWorkspaces: session ? [session.cwd] : []
      }
      const body = Array.from(new TextEncoder().encode(JSON.stringify(settings)))
      return operation === "read"
        ? { type: "read", body }
        : { type: "stat", exists: true, size: body.length, mtime: null, isFile: true, isDirectory: false }
    }
    const location = await locate(path)
    if (!location.scope && location.path === "data.json") {
      if (!storage) throw new Error("扩展配置存储尚未绑定或已关闭")
      if (operation === "write") {
        const body = extra.body as number[]
        if (body.length > 8 * 1024 * 1024) throw new Error("扩展配置超过 8 MiB")
        const value: Json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(body)))
        await storage.write(value)
        return { type: "ok" }
      }
      const value = await storage.read()
      const exists = await storage.exists()
      if (operation === "stat")
        return {
          type: "stat",
          exists,
          size: exists ? new TextEncoder().encode(JSON.stringify(value)).length : 0,
          mtime: null,
          isFile: true,
          isDirectory: false
        }
      if (operation === "read") {
        if (!exists) throw new Error("文件不存在：data.json")
        return { type: "read", body: Array.from(new TextEncoder().encode(JSON.stringify(value))) }
      }
      throw new Error("配置文件仅支持读取和写入，请使用 saveData 更新配置")
    }
    const result = await files.file({ operation, ...location, ...extra } as NativeFileRequest)
    if (
      !location.scope &&
      location.path === "." &&
      result.type === "list" &&
      storage &&
      (await storage.exists()) &&
      !result.entries.some(entry => entry.name === "data.json")
    ) {
      result.entries.push({ name: "data.json", isFile: true, isDirectory: false })
    }
    return result
  }

  const exportPath = (path: string): string => {
    const normalized = normalizedPath(path)
    if (!normalized || normalized === "." || normalized.startsWith("/") || normalized.includes(":"))
      throw new Error("导出路径必须位于授权目录内")
    validateLegacyExport(extensionId, normalized)
    return normalized
  }

  const captureChatContext = (): void => {
    dependencies.check()
    if (target) return
    const current = dependencies.session()
    if (!current) return
    target = { ...current }
  }
  const requireTarget = (): ExtensionChatSession => {
    if (!target) throw new Error("请先打开一个会话，再操作扩展；发送目标在操作开始时绑定")
    return target
  }
  const requireExportDirectory = async (): Promise<DirectoryGrant> => {
    const session = requireTarget()
    if (exportDirectory) return exportDirectory
    dependencies.notify(`分析文件绑定到会话：${session.title || session.id}`, 5000)
    const grants = await files.directories()
    const existing = grants.find(grant => normalizedPath(grant.path) === normalizedPath(session.cwd))
    if (existing) {
      exportDirectory = existing
      return existing
    }
    dependencies.notify("请选择当前会话的工作目录，用于保存分析文件", 6000)
    const chosen = await files.pickDirectory()
    if (!chosen) throw new Error("已取消分析文件目录选择")
    if (normalizedPath(chosen.path) !== normalizedPath(session.cwd)) {
      throw new Error("请选择已绑定会话的工作目录，确保 AI 可以读取分析文件")
    }
    exportDirectory = chosen
    return chosen
  }
  return {
    bindStorage(value: LegacyStorage): Dispose {
      dependencies.check()
      if (storage) throw new Error("扩展配置存储已绑定")
      storage = value
      return () => {
        if (storage === value) storage = undefined
      }
    },
    primary: dependencies.primary,
    language: dependencies.language,
    notify: dependencies.notify,
    captureChatContext,
    openView(id: string): void {
      dependencies.check()
      dependencies.openView(id)
    },
    async openExternal(url: string): Promise<void> {
      dependencies.check()
      if (!["https:", "http:"].includes(new URL(url).protocol)) throw new Error("仅支持 HTTP(S) 外部链接")
      await dependencies.openExternal(url)
    },
    ...(imported
      ? {
          loadInitialData: (): Promise<Json | null> => native("legacy_take_initial_data"),
          acknowledgeInitialData: (): Promise<void> => native("legacy_ack_initial_data")
        }
      : {}),
    fetch,
    ...createExtensionChatBridge({
      check: dependencies.check,
      session: () => (exportDirectory ? requireTarget() : dependencies.session()),
      send: dependencies.send,
      setDraft: dependencies.setDraft,
      prepare: text => {
        let prompt = text
        for (const [relative, absolute] of exported) prompt = prompt.replaceAll(relative, absolute)
        return prompt
      }
    }),
    vault: {
      async write(path: string, data: string): Promise<void> {
        path = exportPath(path)
        const directory = await requireExportDirectory()
        await files.file({
          operation: "write",
          scope: directory.scope,
          path,
          body: Array.from(new TextEncoder().encode(data))
        })
        exported.set(path, `${normalizedPath(directory.path)}/${path}`)
      },
      async remove(path: string): Promise<void> {
        path = exportPath(path)
        const directory = await requireExportDirectory()
        await files.file({ operation: "remove", scope: directory.scope, path })
        exported.delete(path)
      }
    },
    async invoke(command: string, args: unknown = {}, options?: unknown): Promise<unknown> {
      dependencies.check()
      const reason = unsupportedLegacyCommand(extensionId, command)
      if (reason) unavailable(reason)
      if (command === "alwith-u:legacy-is-primary") return dependencies.primary
      if (command === "plugin:path|resolve_directory") {
        if (object(args).directory === 4) return appData
        if (object(args).directory !== 21) throw new Error("不支持访问 Desktop 的应用数据目录")
        return home
      }
      if (command === "plugin:path|join") {
        const paths = object(args).paths
        if (!Array.isArray(paths)) throw new Error("无效的路径列表")
        return normalizedPath(paths.map(string).join("/"))
      }
      if (command === "alwith-u:legacy-workspaces") {
        const directories = await files.directories()
        return directories.map(item => item.path)
      }
      if (command === "plugin:dialog|open") {
        const result = await files.pickDirectory()
        return result?.path ?? null
      }
      if (command === "plugin:fs|write_text_file") {
        if (!(args instanceof Uint8Array)) throw new Error("写文件必须提供字节数组")
        const headers = object(object(options).headers)
        const path = decodeURIComponent(string(headers.path))
        await file("write", path, { body: Array.from(args) })
        return null
      }
      const operations: Record<string, string> = {
        "plugin:fs|read_text_file": "read",
        "plugin:fs|read_dir": "list",
        "plugin:fs|stat": "stat",
        "plugin:fs|mkdir": "mkdir",
        "plugin:fs|remove": "remove"
      }
      const operation = operations[command]
      if (operation) {
        const values = object(args)
        const result = await file(
          operation,
          string(values.path),
          values.options ? { recursive: object(values.options).recursive === true } : {}
        )
        if (result.type === "read") return result.body
        if (result.type === "list") return result.entries
        if (result.type === "stat") {
          if (!result.exists) throw new Error("文件不存在")
          return { ...result, mtime: result.mtime === null ? null : new Date(result.mtime) }
        }
        return null
      }
      if (command === "plugin:clipboard-manager|write_text") {
        await dependencies.clipboard(string(object(args).text))
        return null
      }
      if (command === "open_url" || command === "plugin:opener|open_url") {
        const url = string(object(args).url)
        if (!["https:", "http:"].includes(new URL(url).protocol)) throw new Error("仅支持 HTTP(S) 外部链接")
        await dependencies.openExternal(url)
        return null
      }
      throw new Error(`alwith-u 不支持此旧版扩展接口：${command}`)
    }
  }
}
