import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareModelCatalog as prepare, type CatalogRunner } from "../model-catalog"

const catalogs: ReturnType<typeof prepare>[] = []
function prepareModelCatalog(...args: Parameters<typeof prepare>): ReturnType<typeof prepare> {
  const catalog = prepare(...args)
  catalogs.push(catalog)
  return catalog
}
const directories: string[] = []
afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.dispose()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const bundled = JSON.stringify({ models: [{ slug: "bundled", visibility: "list", context_window: 100 }] })
const refreshed = JSON.stringify({ models: [{ slug: "new-model", visibility: "list", context_window: 200 }] })
const launcher = { command: "/codex", prefixArgs: [], shell: false }
function fixture(): { env: NodeJS.ProcessEnv; warnings: string[]; runner: CatalogRunner } {
  const home = mkdtempSync(join(tmpdir(), "model-catalog-test-"))
  directories.push(home)
  const extra = join(home, "extra.json")
  writeFileSync(extra, JSON.stringify({ models: [{ slug: "gateway", visibility: "list" }] }))
  writeFileSync(join(home, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "test-account-a" }))
  const warnings: string[] = []
  return {
    env: { CODEX_HOME: home, CODEX_ACP_MODEL_CATALOGS: extra },
    warnings,
    runner: {
      bundled: () => bundled,
      configured: () => bundled,
      refresh: async () => refreshed,
      warn: message => warnings.push(message)
    }
  }
}
function models(path: string | null): Array<Record<string, unknown>> {
  if (path === null) throw new Error("Expected a merged catalog")
  return JSON.parse(readFileSync(path, "utf8")).models
}

test("startup does not wait for refresh and never changes the active catalog", async () => {
  const { env, runner } = fixture()
  const pending = Promise.withResolvers<string>()
  runner.refresh = () => pending.promise
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  expect(models(catalog.path)).toEqual([{ slug: "bundled", visibility: "list", context_window: 100 }])
  pending.resolve(refreshed)
  await catalog.refresh
  expect(models(catalog.path)[0]?.slug).toBe("bundled")
  const next = prepareModelCatalog(launcher, env, "0.159.2", {
    ...runner,
    bundled: () => {
      throw new Error("Fresh cache should avoid a subprocess")
    },
    refresh: async () => {
      throw new Error("Fresh cache should avoid refresh")
    }
  })
  expect(models(next.path)[0]?.slug).toBe("new-model")
  await next.refresh
})

test("a failed background refresh leaves startup usable and reports the failure", async () => {
  const { env, runner, warnings } = fixture()
  runner.refresh = async () => {
    throw new Error("offline")
  }
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  await catalog.refresh
  expect(models(catalog.path)[0]?.slug).toBe("bundled")
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("refresh")
})

test("an expired cache remains usable when refresh fails", async () => {
  const { env, runner, warnings } = fixture()
  await prepareModelCatalog(launcher, env, "0.159.2", runner).refresh
  const directory = join(env.CODEX_HOME!, "cache", "alwith-u-models")
  const file = join(
    directory,
    readdirSync(directory).find(name => name.endsWith(".json"))!
  )
  const cached = JSON.parse(readFileSync(file, "utf8"))
  writeFileSync(file, JSON.stringify({ ...cached, fetchedAt: 0 }))
  runner.refresh = async () => {
    throw new Error("offline")
  }
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  expect(models(catalog.path)[0]?.slug).toBe("new-model")
  await catalog.refresh
  expect(warnings).toHaveLength(1)
})

test.each(["version", "account", "config", "environment"])("%s changes invalidate the cache", async change => {
  const { env, runner } = fixture()
  await prepareModelCatalog(launcher, env, "0.159.2", runner).refresh
  if (change === "account") writeFileSync(join(env.CODEX_HOME!, "auth.json"), '{"OPENAI_API_KEY":"account-b"}')
  if (change === "config") writeFileSync(join(env.CODEX_HOME!, "config.toml"), 'model_provider = "other"')
  if (change === "environment") env.OPENAI_BASE_URL = "https://other.example"
  const catalog = prepareModelCatalog(launcher, env, change === "version" ? "0.160.0" : "0.159.2", runner)
  expect(models(catalog.path)[0]?.slug).toBe("bundled")
  await catalog.refresh
})

test("corrupt cache is reported and replaced without delaying startup", async () => {
  const { env, runner, warnings } = fixture()
  await prepareModelCatalog(launcher, env, "0.159.2", runner).refresh
  const directory = join(env.CODEX_HOME!, "cache", "alwith-u-models")
  const file = join(
    directory,
    readdirSync(directory).find(name => name.endsWith(".json"))!
  )
  writeFileSync(file, "{broken")
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  expect(models(catalog.path)[0]?.slug).toBe("bundled")
  expect(warnings).toHaveLength(1)
  await catalog.refresh
  expect(models(prepareModelCatalog(launcher, env, "0.159.2", runner).path)[0]?.slug).toBe("new-model")
})

test("invalid refresh data cannot replace a previously valid cache", async () => {
  const { env, runner, warnings } = fixture()
  runner.refresh = async () => '{"models":[{"slug":42}]}'
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  await catalog.refresh
  expect(warnings).toHaveLength(1)
  expect(models(catalog.path)[0]?.slug).toBe("bundled")
})

test("the U snapshot contains only native metadata; gateway merging belongs to the adapter", async () => {
  const { env, runner } = fixture()
  await prepareModelCatalog(launcher, env, "0.159.2", runner).refresh
  writeFileSync(
    env.CODEX_ACP_MODEL_CATALOGS!,
    JSON.stringify({ models: [{ slug: "new-model", context_window: 1 }, { slug: "second-gateway" }] })
  )
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  expect(models(catalog.path)).toEqual([{ slug: "new-model", visibility: "list", context_window: 200 }])
  await catalog.refresh
})

test("disposing an adapter aborts refresh without writing cache or reporting a failure", async () => {
  const { env, runner, warnings } = fixture()
  runner.refresh = signal =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
    })
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  catalog.dispose()
  await catalog.refresh
  expect(warnings).toEqual([])
  expect(existsSync(catalog.path!)).toBe(false)
  expect(existsSync(join(env.CODEX_HOME!, "cache", "alwith-u-models"))).toBe(false)
})

test("cache write failure is reported without failing the active session", async () => {
  const { env, runner, warnings } = fixture()
  mkdirSync(join(env.CODEX_HOME!, "cache"))
  writeFileSync(join(env.CODEX_HOME!, "cache", "alwith-u-models"), "not a directory")
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  await catalog.refresh
  expect(models(catalog.path)[0]?.slug).toBe("bundled")
  expect(warnings.length).toBeGreaterThan(0)
})

test("invalid bundled data remains a hard failure", () => {
  const { env, runner } = fixture()
  runner.bundled = () => '{"models":[]}'
  expect(() => prepareModelCatalog(launcher, env, "0.159.2", runner)).toThrow()
})

test("without extra catalogs, Codex keeps its native catalog path", async () => {
  const { env, runner } = fixture()
  const catalog = prepareModelCatalog(launcher, { ...env, CODEX_ACP_MODEL_CATALOGS: "" }, "0.159.2", runner)
  expect(catalog.path).toBeNull()
  await catalog.refresh
})

test("explicit native catalogs retain Codex configuration and bypass bundled/cache selection", async () => {
  const { env, runner, warnings } = fixture()
  writeFileSync(join(env.CODEX_HOME!, "config.toml"), 'model_catalog_json = "/custom/models.json"')
  runner.configured = () => JSON.stringify({ models: [{ slug: "custom-model" }] })
  runner.bundled = () => {
    throw new Error("Custom configuration must remain authoritative")
  }
  runner.refresh = async () => {
    throw new Error("Custom catalogs must not be cached")
  }
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  expect(models(catalog.path)[0]?.slug).toBe("custom-model")
  await catalog.refresh
  expect(warnings).toEqual([])
})

test("a credentials change during refresh cannot populate the previous account cache", async () => {
  const { env, runner } = fixture()
  const pending = Promise.withResolvers<string>()
  runner.refresh = () => pending.promise
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  writeFileSync(join(env.CODEX_HOME!, "auth.json"), '{"OPENAI_API_KEY":"account-b"}')
  pending.resolve(refreshed)
  await catalog.refresh
  expect(existsSync(join(env.CODEX_HOME!, "cache", "alwith-u-models"))).toBe(false)
})

test("keyring credentials retain native lookup instead of reusing a file-account catalog", async () => {
  const { env, runner, warnings } = fixture()
  await prepareModelCatalog(launcher, env, "0.159.2", runner).refresh
  writeFileSync(join(env.CODEX_HOME!, "config.toml"), 'cli_auth_credentials_store = "keyring"')
  runner.configured = () => JSON.stringify({ models: [{ slug: "keyring-account-model" }] })
  runner.refresh = async () => {
    throw new Error("Cannot persist an unidentified account's catalog")
  }
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  expect(models(catalog.path)[0]?.slug).toBe("keyring-account-model")
  await catalog.refresh
  expect(warnings).toEqual([])
})

test("advisory configuration parsing cannot override Codex's own validation", async () => {
  const { env, runner, warnings } = fixture()
  writeFileSync(join(env.CODEX_HOME!, "config.toml"), "[broken")
  runner.configured = () => JSON.stringify({ models: [{ slug: "native-resolved" }] })
  const catalog = prepareModelCatalog(launcher, env, "0.159.2", runner)
  expect(models(catalog.path)[0]?.slug).toBe("native-resolved")
  expect(warnings).toHaveLength(1)
  await catalog.refresh
})
