import { describe, expect, test } from "vitest"
import { convertLegacyExtension, patchLegacySource } from "../import"
import { legacyProfile } from "../profiles"

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
    expect(patchLegacySource("generic-reader", source)).toBe(source)
  })

  test("known adapters never bypass their source match and native identity is preserved", async () => {
    const prepared = {
      ticket: "test",
      manifest: { id: "yup-kb", name: "YUP", version: "2.20.0" },
      convertedManifest: { id: "yup-kb" },
      source: "unreviewed()",
      styles: "",
      modules: {}
    }
    await expect(convertLegacyExtension(prepared)).rejects.toThrow("已审核版本")
    await expect(
      convertLegacyExtension({ ...prepared, manifest: { id: "generic" }, convertedManifest: { id: "other" } })
    ).rejects.toThrow("ID")
  })

  test("patches only exact reviewed sections and removes session and Desktop discovery paths", () => {
    const profile = legacyProfile("yup-kb")
    const source = profile.patches.map(patch => patch.before).join("\n/* unaffected section */\n")
    const patched = patchLegacySource(profile.id, source)
    expect(patched).toContain("/* unaffected section */")
    expect(patched).toContain("会话归档暂不支持，其他知识库功能可用")
    expect(patched).toContain('invoke("alwith-u:legacy-workspaces", {})')
    expect(patched).not.toContain('"list_sessions"')
    expect(patched).not.toContain('var _appId = "ai.alwith.desktop"')
    expect(patched).not.toContain("syncState.consented === true ?")
    expect(patched).not.toContain("_filterJsonlForArchive(rawC)")
    expect(() => patchLegacySource(profile.id, source + profile.patches[0].before)).toThrow("不匹配")
    expect(() => patchLegacySource(profile.id, "different source")).toThrow("不匹配")
  })

  test("BI import removes skill auto-updater while ETMS source remains untouched", () => {
    const profile = legacyProfile("bi-metrics")
    const patched = patchLegacySource(profile.id, profile.patches.map(patch => patch.before).join("\n"))
    expect(patched).not.toContain("setTimeout")
    expect(patched).not.toContain("syncSkillsToDisk")
    expect(patched).toContain("Codex catalog")
    expect(patchLegacySource("etms-strategy-review", "business source")).toBe("business source")
  })
})
