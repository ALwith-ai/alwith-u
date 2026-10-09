import { describe, expect, test } from "vitest"
import { convertLegacyExtension } from "../import"

describe("generic import with optional host adapters", () => {
  test("imports a new local identity and module resources without executing source", async () => {
    const manifest = {
      manifestVersion: 3,
      id: "generic-reader",
      name: "Reader",
      version: "1.0.0",
      entry: "main.js",
      dependencies: { "@alwith/module-extension": "^0.1.4" },
      hosts: { "alwith-u": ">=0.1.1" },
      dataSchemaVersion: 1
    }
    const source = "throw new Error('must not run during import')"
    const converted = await convertLegacyExtension({
      ticket: "generic",
      manifest: { id: "generic-reader", name: "Reader", version: "1.0.0", minAppVersion: "26.6.18" },
      convertedManifest: manifest,
      source,
      styles: "",
      modules: { "assets/defaults.json": '{"title":"Demo"}' }
    })
    expect(converted.manifest).toEqual(manifest)
    expect(converted.main).toContain(source)
    expect(converted.main).toContain("assets/defaults.json")
  })

  test("preserves source from the native import ticket for known profiles", async () => {
    const prepared = {
      ticket: "test",
      manifest: { id: "yup-kb", name: "YUP", version: "2.20.0" },
      convertedManifest: { id: "yup-kb" },
      source: "unreviewed()",
      styles: "",
      modules: {}
    }
    const converted = await convertLegacyExtension(prepared)
    expect(converted.main).toContain(JSON.stringify(prepared.source))
    await expect(
      convertLegacyExtension({ ...prepared, manifest: { id: "generic" }, convertedManifest: { id: "other" } })
    ).rejects.toThrow("ID")
  })

  test("does not embed business source transformations in host profiles", async () => {
    const { default: profiles } = await import("../profiles.json")
    for (const profile of profiles) {
      expect(profile).not.toHaveProperty("patches")
      expect(profile).not.toHaveProperty("patchedSha256")
    }
  })
})
