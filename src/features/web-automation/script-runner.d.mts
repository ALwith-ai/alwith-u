export const DEFAULT_TIMEOUT_MS: number
export const MAX_TIMEOUT_MS: number
export interface TabEndpoint {
  host: string
  port: number
  path: string
  token: string
}
export interface ScriptRun {
  script?: string
  code?: string
  /** Opaque state from the engine, passed on unchanged. */
  sandboxState: unknown
  tab: TabEndpoint
  launcher: string
  runtime: string
  shim: string
  timeoutMs: number
  onStart?: (stop: () => void) => void
}
export interface ScriptResult {
  ok: boolean
  exitCode: number | null
  signal?: string
  stopped?: "canceled" | "timed out"
  stdout: string
  stderr: string
  cwd: string
}
/** Serves a Unix socket whose connections open only `tab`; resolves to a function that closes it. */
export function serveTab(socketPath: string, tab: TabEndpoint): Promise<() => Promise<void>>
export function runScript(options: ScriptRun): Promise<ScriptResult>
