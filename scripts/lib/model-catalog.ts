import { createHash, randomUUID } from "node:crypto"
import { execFile, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

export type CatalogRunner = {
  bundled(): string
  configured(): string
  refresh(signal: AbortSignal): Promise<string>
  warn(message: string): void
}
type Launcher = { command: string; prefixArgs: string[]; shell: boolean }
type Catalog = { models: Array<Record<string, unknown>>; [key: string]: unknown }
type PreparedCatalog = { path: string | null; refresh: Promise<void>; dispose(): void }
const refreshAfterMs = 60 * 60 * 1000
const maxBuffer = 64 * 1024 * 1024

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
function optionalFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}
function parseCatalog(value: unknown): Catalog {
  if (
    typeof value !== "object" ||
    value === null ||
    !("models" in value) ||
    !Array.isArray(value.models) ||
    value.models.length === 0 ||
    value.models.some(
      model => typeof model !== "object" || model === null || typeof model.slug !== "string" || model.slug.length === 0
    )
  ) {
    throw new Error("Invalid model catalog: expected models with non-empty slugs")
  }
  return value as Catalog
}
function runnerFor(launcher: Launcher, env: NodeJS.ProcessEnv): CatalogRunner {
  function dump(bundled: boolean): string {
    const result = spawnSync(
      launcher.command,
      [...launcher.prefixArgs, "debug", "models", ...(bundled ? ["--bundled"] : [])],
      {
        shell: launcher.shell,
        env,
        encoding: "utf8",
        maxBuffer,
        timeout: 10_000
      }
    )
    if (result.error || result.status !== 0)
      throw new Error(`Codex catalog failed: ${result.error?.message ?? result.stderr.trim()}`)
    return result.stdout
  }
  return {
    bundled: () => dump(true),
    configured: () => dump(false),
    refresh(signal) {
      return new Promise((resolveOutput, reject) => {
        execFile(
          launcher.command,
          [...launcher.prefixArgs, "debug", "models"],
          {
            shell: launcher.shell,
            env,
            encoding: "utf8",
            maxBuffer,
            timeout: 15_000,
            signal
          },
          (error, stdout) => (error ? reject(error) : resolveOutput(stdout))
        )
      })
    },
    warn(message) {
      process.stderr.write(`[alwith-u-models] ${message}\n`)
    }
  }
}

/** A custom catalog is authoritative. Keep Codex's own configuration/profile resolution rather
 * than interpreting its precedence here. A catalog in an inactive profile conservatively opts out.
 */
function hasCustomCatalog(env: NodeJS.ProcessEnv, warn: CatalogRunner["warn"]): boolean {
  const files = new Set([
    join(resolve(env.CODEX_HOME || join(homedir(), ".codex")), "config.toml"),
    "/etc/codex/config.toml"
  ])
  for (let cwd = process.cwd(); ; cwd = dirname(cwd)) {
    files.add(join(cwd, ".codex", "config.toml"))
    if (dirname(cwd) === cwd) break
  }
  function containsCatalog(value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      ("model_catalog_json" in value || Object.values(value).some(containsCatalog))
    )
  }
  return [...files].some(file => {
    try {
      const text = optionalFile(file)
      return text !== null && containsCatalog(Bun.TOML.parse(text))
    } catch (error) {
      // Codex may ignore an untrusted or unrelated project config. Only it can decide validity.
      warn(`Model catalog configuration detection deferred to Codex: ${String(error)}`)
      return true
    }
  })
}

/** The cache is disposable metadata, scoped to the executable, version and credential/config snapshot.
 * Keyring-only credentials have no safe local identity fingerprint, so those launches retain the native
 * catalog lookup and do not reuse a persistent catalog. No credentials are written to this cache.
 */
function cachePath(launcher: Launcher, env: NodeJS.ProcessEnv, version: string): string | null {
  const home = resolve(env.CODEX_HOME || join(homedir(), ".codex"))
  const auth = optionalFile(join(home, "auth.json"))
  const config = optionalFile(join(home, "config.toml"))
  const settings = config === null ? {} : Bun.TOML.parse(config)
  const authStore = "cli_auth_credentials_store" in settings ? settings.cli_auth_credentials_store : undefined
  if (authStore !== undefined && authStore !== "file") return null
  if (auth === null && !env.OPENAI_API_KEY && !env.CODEX_API_KEY) return null
  const environment = Object.entries(env)
    .filter(([key]) => /^(CODEX_|OPENAI_|AZURE_OPENAI_)/.test(key) && key !== "CODEX_ACP_MODEL_CATALOGS")
    .sort(([a], [b]) => a.localeCompare(b))
  const key = createHash("sha256")
    .update(JSON.stringify({ schema: 1, launcher, version, home, auth, config, environment }))
    .digest("hex")
  return join(home, "cache", "alwith-u-models", `${key}.json`)
}

/** Select an immutable startup snapshot. Refresh may populate the next launch's cache but must never
 * delay ACP initialization or replace the catalog used by a running Codex app-server.
 */
export function prepareModelCatalog(
  launcher: Launcher,
  env: NodeJS.ProcessEnv,
  version: string,
  runner = runnerFor(launcher, env)
): PreparedCatalog {
  const raw = env.CODEX_ACP_MODEL_CATALOGS
  if (raw === undefined || raw.trim() === "") return { path: null, refresh: Promise.resolve(), dispose() {} }
  let cache: string | null = null
  const custom = hasCustomCatalog(env, runner.warn)
  let base: Catalog | undefined
  let fresh = false
  try {
    cache = custom ? null : cachePath(launcher, env, version)
    const contents = cache === null ? null : optionalFile(cache)
    if (contents !== null) {
      const saved: unknown = JSON.parse(contents)
      if (
        typeof saved !== "object" ||
        saved === null ||
        !("fetchedAt" in saved) ||
        typeof saved.fetchedAt !== "number" ||
        !Number.isFinite(saved.fetchedAt) ||
        !("catalog" in saved)
      ) {
        throw new Error("Invalid model catalog cache")
      }
      base = parseCatalog(saved.catalog)
      const age = Date.now() - saved.fetchedAt
      fresh = age >= 0 && age < refreshAfterMs
    }
  } catch (error) {
    runner.warn(`Model catalog cache unavailable: ${String(error)}`)
  }
  base ??= parseCatalog(JSON.parse(custom || cache === null ? runner.configured() : runner.bundled()))
  const directory = mkdtempSync(join(tmpdir(), "alwith-u-models-catalog-"))
  const path = join(directory, "models.json")
  try {
    writeFileSync(path, JSON.stringify(base), { mode: 0o600 })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  const controller = new AbortController()
  const refresh =
    fresh || cache === null
      ? Promise.resolve()
      : (async () => {
          let temporary: string | undefined
          try {
            const catalog = parseCatalog(JSON.parse(await runner.refresh(controller.signal)))
            if (controller.signal.aborted) return
            // Login/config may change while the subprocess refreshes. Never cache that result under the old identity.
            if (cachePath(launcher, env, version) !== cache) return
            mkdirSync(join(resolve(env.CODEX_HOME || join(homedir(), ".codex")), "cache", "alwith-u-models"), {
              recursive: true,
              mode: 0o700
            })
            temporary = `${cache}.${randomUUID()}.tmp`
            writeFileSync(temporary, JSON.stringify({ fetchedAt: Date.now(), catalog }), { mode: 0o600 })
            renameSync(temporary, cache)
            temporary = undefined
          } catch (error) {
            if (!controller.signal.aborted)
              runner.warn(`Model catalog refresh failed; keeping startup catalog: ${String(error).slice(0, 500)}`)
          } finally {
            if (temporary !== undefined) {
              try {
                rmSync(temporary, { force: true })
              } catch (error) {
                runner.warn(`Model catalog temporary file cleanup failed: ${String(error)}`)
              }
            }
          }
        })()
  return {
    path,
    refresh,
    dispose() {
      controller.abort()
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch (error) {
        runner.warn(`Model catalog cleanup failed: ${String(error)}`)
      }
    }
  }
}
