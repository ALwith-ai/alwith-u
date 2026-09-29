import { describe, expect, test } from "bun:test"
import { convertLegacyExtension, convertLegacyManifest, patchLegacySource } from "../import"
import { legacyProfile } from "../profiles"

describe("finite legacy extension import", () => {
  test("preserves business version, maps icons and omits empty or loader metadata", () => {
    const manifest = convertLegacyManifest({
      id: "yup-kb",
      name: "YUP 知识库",
      version: "2.20.0",
      author: "",
      authorUrl: "  ",
      description: "知识库",
      updateUrl: "https://example.com/loader",
      minAppVersion: "26.6.18"
    })
    expect(manifest).toEqual({
      manifestVersion: 3,
      id: "yup-kb",
      name: "YUP 知识库",
      version: "2.20.0",
      description: "知识库",
      icon: "lucide:globe",
      entry: "main.js",
      dependencies: { "@alwith/module-extension": "^0.1.2" },
      hosts: { "alwith-u": ">=0.1.1" },
      dataSchemaVersion: 1
    })
    expect(convertLegacyManifest({ id: "bi-metrics", name: "BI", version: "2.36.2" }).icon).toBe("lucide:chart")
    expect(convertLegacyManifest({ id: "etms-strategy-review", name: "ETMS", version: "0.1.0" }).icon).toBe(
      "lucide:settings"
    )
  })

  test("rejects unknown identities, incomplete manifests and unreviewed executable bytes", async () => {
    expect(() => convertLegacyManifest({ id: "unknown", name: "Other", version: "1.0.0" })).toThrow("不支持")
    expect(() => convertLegacyManifest({ id: "yup-kb", name: "YUP", version: "latest" })).toThrow("版本")
    expect(() => convertLegacyManifest({ id: "yup-kb", name: " ", version: "1.0.0" })).toThrow("名称")
    await expect(
      convertLegacyExtension({
        ticket: "test",
        manifest: { id: "yup-kb", name: "YUP", version: "2.20.0" },
        source: "throw new Error('must not run')",
        styles: ""
      })
    ).rejects.toThrow("已审核版本")
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
