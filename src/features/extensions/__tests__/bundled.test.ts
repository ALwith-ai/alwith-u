import { parseManifest } from "@alwith/module-extension"
import type { RuntimeSnapshot } from "@alwith/module-extension/host"
import type { Installation, Request } from "@alwith/module-extension/tauri"
import { expect, test } from "vitest"
import { ensureBundledExtension } from "../bundled"

const manifest = parseManifest({
  id: "host-notes",
  name: "Test extension",
  version: "1.0.0",
  dependencies: { "@alwith/module-extension": "^0.1.0" }
})

const bundle = { id: manifest.id, version: manifest.version, source: "bundled:alwith-u", path: "/bundled/host-notes" }
function installation(version: string, enabled: boolean): Installation {
  return {
    id: manifest.id,
    manifest: { ...manifest, version },
    enabled,
    source: bundle.source,
    installationId: "installed",
    packageRevision: "revision",
    dataGeneration: 1
  }
}
function boundary(current?: Installation) {
  const requests: Request[] = []
  const state: RuntimeSnapshot = {
    busy: false,
    errors: {},
    native: { installations: current ? [current] : [], pending: [], protocolVersion: 1, sequence: 1, serviceId: "test" }
  }
  return {
    requests,
    snapshot: (): RuntimeSnapshot => state,
    request: async (request: Request): Promise<void> => {
      requests.push(request)
    }
  }
}
test("first installation pins package identity before enabling", async (): Promise<void> => {
  const runtime = boundary()
  await ensureBundledExtension(runtime, bundle)
  expect(runtime.requests).toEqual([
    {
      type: "installLocal",
      path: bundle.path,
      source: bundle.source,
      expectedId: bundle.id,
      expectedVersion: bundle.version
    },
    { type: "enable", id: bundle.id }
  ])
})
test("repeat startup preserves disabled state and does not downgrade", async (): Promise<void> => {
  for (const version of [manifest.version, "1.1.0"]) {
    const runtime = boundary(installation(version, false))
    await ensureBundledExtension(runtime, bundle)
    expect(runtime.requests).toEqual([])
  }
})
test("updates go through the native transition without forcing enable", async (): Promise<void> => {
  const runtime = boundary(installation("0.9.0", false))
  await ensureBundledExtension(runtime, bundle)
  expect(runtime.requests).toEqual([
    { type: "beginTransition", action: "update", id: bundle.id, path: bundle.path, source: bundle.source }
  ])
})
test("a conflicting local installation is never overwritten", async (): Promise<void> => {
  const runtime = boundary({ ...installation("0.9.0", true), source: "local" })
  await expect(ensureBundledExtension(runtime, bundle)).rejects.toThrow("local extension")
  expect(runtime.requests).toEqual([])
})

test("a newly discovered bundle installs and updates without a configuration entry", async (): Promise<void> => {
  const other = { ...bundle, id: "host-clock", path: "/bundled/clock" }
  const fresh = boundary()
  await ensureBundledExtension(fresh, other)
  expect(fresh.requests).toEqual([
    {
      type: "installLocal",
      path: other.path,
      source: other.source,
      expectedId: other.id,
      expectedVersion: other.version
    },
    { type: "enable", id: other.id }
  ])
  const current = installation("0.9.0", false)
  const existing = boundary({ ...current, id: other.id, manifest: { ...current.manifest, id: other.id } })
  await ensureBundledExtension(existing, other)
  expect(existing.requests).toEqual([
    { type: "beginTransition", action: "update", id: other.id, path: other.path, source: other.source }
  ])
})

test("an unexpected bundle source cannot trigger installation", async (): Promise<void> => {
  const runtime = boundary()
  await expect(ensureBundledExtension(runtime, { ...bundle, source: "local" })).rejects.toThrow(
    "Unexpected extension bundle"
  )
  expect(runtime.requests).toEqual([])
})
