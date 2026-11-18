import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type CatalogRunner,
  joinModelCatalogPaths,
  prepareModelCatalog as prepare,
  splitModelCatalogPaths
} from "../model-catalog"

test("Windows catalog lists preserve quoted paths containing semicolons", () => {
  expect(splitModelCatalogPaths(String.raw`"C:\Users\A;B\models.json";D:\app\custom.json`, "win32")).toEqual([
    String.raw`C:\Users\A;B\models.json`,
    String.raw`D:\app\custom.json`
  ])
  expect(splitModelCatalogPaths("/Users/A;B/models.json:/tmp/custom.json", "darwin")).toEqual([
    "/Users/A;B/models.json",
    "/tmp/custom.json"
  ])
})

test("script catalog lists use the same Windows quoting as the native host", () => {
  const paths = [String.raw`C:\Users\A;B\models.json`, String.raw`D:\app\custom.json`]
  const joined = joinModelCatalogPaths(paths, "win32")
  expect(joined).toBe(String.raw`"C:\Users\A;B\models.json";D:\app\custom.json`)
  expect(splitModelCatalogPaths(joined, "win32")).toEqual(paths)
  expect(() => joinModelCatalogPaths([String.raw`C:\bad"name.json`], "win32")).toThrow("cannot contain a quote")
})

type PreparedCatalog = Awaited<ReturnType<typeof prepare>>
const catalogs: PreparedCatalog[] = []
async function prepareModelCatalog(...args: Parameters<typeof prepare>): Promise<PreparedCatalog> {
  const catalog = await prepare(...args)
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
      refresh: () => Promise.resolve(refreshed),
      warn: (message) => warnings.push(message)
    }
  }
}
function models(path: string | null): Array<Record<string, unknown>> {
  if (path === null) throw new Error("Expected a merged catalog")
  return (JSON.parse(readFileSync(path, "utf8")) as { models: Array<Record<string, unknown>> }).models
}
function cacheFile(env: NodeJS.ProcessEnv): string {
  const directory = join(env.CODEX_HOME!, "cache", "alwith-u-models")
  const file = readdirSync(directory).find((name) => name.endsWith(".json"))
  if (file === undefined) throw new Error("Expected a cached catalog")
  return join(directory, file)
}
function expireCache(env: NodeJS.ProcessEnv): void {
  const file = cacheFile(env)
  const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  writeFileSync(file, JSON.stringify({ ...saved, fetchedAt: 0 }))
}

test("cold startup waits for upstream metadata and exposes new models in the first snapshot", async () => {
  const { env, runner } = fixture()
  const pending = Promise.withResolvers<string>()
  const started = Promise.withResolvers<void>()
  runner.refresh = (signal) => {
    expect(signal.aborted).toBe(false)
    started.resolve()
    return pending.promise
  }
  let ready = false
  const preparing = prepareModelCatalog(launcher, env, "0.169.0", runner).then((catalog) => {
    ready = true
    return catalog
  })
  await started.promise
  expect(ready).toBe(false)
  pending.resolve(
    JSON.stringify({
      models: [
        { slug: "gpt-6.2-sol", visibility: "list", context_window: 500000 },
        { slug: "gpt-6.2-astra", visibility: "list", context_window: 272000 }
      ]
    })
  )
  const catalog = await preparing
  expect(models(catalog.path)).toEqual([
    { slug: "gpt-6.2-sol", visibility: "list", context_window: 500000 },
    { slug: "gpt-6.2-astra", visibility: "list", context_window: 272000 },
    { slug: "gateway", visibility: "hide" }
  ])
  const saved = JSON.parse(readFileSync(cacheFile(env), "utf8")) as { catalog: { models: unknown[] } }
  expect(saved.catalog.models).toHaveLength(2)
})

test("fresh metadata avoids upstream lookup and leaves existing snapshots immutable", async () => {
  const { env, runner } = fixture()
  const first = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  const before = readFileSync(first.path!, "utf8")
  runner.refresh = () => {
    throw new Error("Fresh cache must not refresh")
  }
  runner.bundled = () => {
    throw new Error("Fresh cache must not load bundled metadata")
  }
  const second = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(models(second.path)[0]?.slug).toBe("new-model")
  expireCache(env)
  runner.refresh = () => Promise.resolve(bundled)
  expect(models((await prepareModelCatalog(launcher, env, "0.169.0", runner)).path)[0]?.slug).toBe("bundled")
  expect(readFileSync(first.path!, "utf8")).toBe(before)
})

test("expired metadata is refreshed before the current startup snapshot is created", async () => {
  const { env, runner } = fixture()
  await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expireCache(env)
  runner.refresh = () => Promise.resolve(bundled)
  expect(models((await prepareModelCatalog(launcher, env, "0.169.0", runner)).path)[0]?.slug).toBe("bundled")
})

test("failed or timed out cold refresh uses bundled metadata without caching it", async () => {
  const { env, runner, warnings } = fixture()
  runner.refresh = () => Promise.reject(new DOMException("Timed out", "TimeoutError"))
  const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(models(catalog.path)[0]?.slug).toBe("bundled")
  expect(warnings).toHaveLength(1)
  expect(existsSync(join(env.CODEX_HOME!, "cache", "alwith-u-models"))).toBe(false)
})

test("an expired cache remains usable when upstream refresh fails", async () => {
  const { env, runner, warnings } = fixture()
  await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expireCache(env)
  const before = readFileSync(cacheFile(env), "utf8")
  runner.refresh = () => Promise.reject(new Error("offline"))
  expect(models((await prepareModelCatalog(launcher, env, "0.169.0", runner)).path)[0]?.slug).toBe("new-model")
  expect(readFileSync(cacheFile(env), "utf8")).toBe(before)
  expect(warnings).toHaveLength(1)
})

test.each(["version", "account", "config", "environment"])(
  "%s changes refresh before selecting metadata",
  async (change) => {
    const { env, runner } = fixture()
    await prepareModelCatalog(launcher, env, "0.169.0", runner)
    if (change === "account") writeFileSync(join(env.CODEX_HOME!, "auth.json"), '{"OPENAI_API_KEY":"account-b"}')
    if (change === "config") writeFileSync(join(env.CODEX_HOME!, "config.toml"), 'model_provider = "other"')
    if (change === "environment") env.OPENAI_BASE_URL = "https://other.example"
    runner.refresh = () => Promise.resolve(bundled)
    const catalog = await prepareModelCatalog(launcher, env, change === "version" ? "0.170.0" : "0.169.0", runner)
    expect(models(catalog.path)[0]?.slug).toBe("bundled")
  }
)

test("corrupt cache is replaced by upstream metadata during startup", async () => {
  const { env, runner, warnings } = fixture()
  await prepareModelCatalog(launcher, env, "0.169.0", runner)
  writeFileSync(cacheFile(env), "{broken")
  const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(models(catalog.path)[0]?.slug).toBe("new-model")
  expect(warnings).toHaveLength(1)
})

test("invalid upstream metadata cannot replace a valid expired cache", async () => {
  const { env, runner, warnings } = fixture()
  await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expireCache(env)
  const before = readFileSync(cacheFile(env), "utf8")
  runner.refresh = () => Promise.resolve('{"models":[{"slug":42}]}')
  const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(models(catalog.path)[0]?.slug).toBe("new-model")
  expect(readFileSync(cacheFile(env), "utf8")).toBe(before)
  expect(warnings).toHaveLength(1)
})

test("gateway metadata cannot override native upstream metadata", async () => {
  const { env, runner } = fixture()
  writeFileSync(
    env.CODEX_ACP_MODEL_CATALOGS!,
    JSON.stringify({ models: [{ slug: "new-model", context_window: 1 }, { slug: "second-gateway" }] })
  )
  const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(models(catalog.path)).toEqual([
    { slug: "new-model", visibility: "list", context_window: 200 },
    { slug: "second-gateway", visibility: "hide" }
  ])
})

test("cache write failure preserves freshly retrieved metadata for the current startup", async () => {
  const { env, runner, warnings } = fixture()
  mkdirSync(join(env.CODEX_HOME!, "cache"))
  writeFileSync(join(env.CODEX_HOME!, "cache", "alwith-u-models"), "not a directory")
  const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(models(catalog.path)[0]?.slug).toBe("new-model")
  expect(warnings.length).toBeGreaterThan(0)
})

test("invalid bundled data remains a hard failure after upstream refresh fails", async () => {
  const { env, runner } = fixture()
  runner.refresh = () => Promise.reject(new Error("offline"))
  runner.bundled = () => '{"models":[]}'
  await expect(prepareModelCatalog(launcher, env, "0.169.0", runner)).rejects.toThrow("Invalid model catalog")
})

test("without extra catalogs Codex retains its native lookup", async () => {
  const { env, runner } = fixture()
  runner.refresh = () => {
    throw new Error("Native lookup must not be intercepted")
  }
  const catalog = await prepareModelCatalog(launcher, { ...env, CODEX_ACP_MODEL_CATALOGS: "" }, "0.169.0", runner)
  expect(catalog.path).toBeNull()
})

test("explicit catalogs and keyring credentials retain Codex configuration resolution", async () => {
  for (const config of ['model_catalog_json = "/custom/models.json"', 'cli_auth_credentials_store = "keyring"']) {
    const { env, runner, warnings } = fixture()
    writeFileSync(join(env.CODEX_HOME!, "config.toml"), config)
    runner.configured = () => JSON.stringify({ models: [{ slug: "custom-model" }] })
    runner.bundled = () => {
      throw new Error("Native configuration is authoritative")
    }
    runner.refresh = () => {
      throw new Error("Unidentified accounts and explicit catalogs must not be cached")
    }
    const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
    expect(models(catalog.path)).toEqual([{ slug: "custom-model" }, { slug: "gateway", visibility: "hide" }])
    expect(warnings).toEqual([])
  }
})

test("a credential change during refresh cannot populate the previous account cache", async () => {
  const { env, runner } = fixture()
  runner.refresh = async () => {
    writeFileSync(join(env.CODEX_HOME!, "auth.json"), '{"OPENAI_API_KEY":"account-b"}')
    return refreshed
  }
  await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(existsSync(join(env.CODEX_HOME!, "cache", "alwith-u-models"))).toBe(false)
})

test("advisory configuration parsing cannot override Codex validation", async () => {
  const { env, runner, warnings } = fixture()
  writeFileSync(join(env.CODEX_HOME!, "config.toml"), "[broken")
  runner.configured = () => JSON.stringify({ models: [{ slug: "native-resolved" }] })
  const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  expect(models(catalog.path)[0]?.slug).toBe("native-resolved")
  expect(warnings).toHaveLength(1)
})

test("disposing a snapshot removes its temporary file but preserves upstream cache", async () => {
  const { env, runner } = fixture()
  const catalog = await prepareModelCatalog(launcher, env, "0.169.0", runner)
  catalog.dispose()
  expect(existsSync(catalog.path!)).toBe(false)
  expect(existsSync(cacheFile(env))).toBe(true)
})
