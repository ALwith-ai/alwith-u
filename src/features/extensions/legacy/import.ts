import { valid } from "semver"
import { legacyProfile } from "./profiles"

export interface PreparedLegacyImport {
  ticket: string
  manifest: Record<string, unknown>
  source: string
  styles: string
}

export interface ConvertedLegacyImport {
  manifest: Record<string, unknown>
  main: string
}

const ENTRY_PREFIX =
  'module.exports.default = function(context) { return require("@alwith/module-extension/legacy").createLegacyExtension(context,'
const ENTRY_SUFFIX = "); };\n"

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}

export function patchLegacySource(id: string, source: string): string {
  for (const patch of legacyProfile(id).patches) {
    if (source.split(patch.before).length !== 2) throw new Error("旧版扩展兼容补丁不匹配")
    source = source.replace(patch.before, () => patch.after)
  }
  return source
}

export function convertLegacyManifest(old: Record<string, unknown>): Record<string, unknown> {
  if (typeof old.id !== "string" || typeof old.name !== "string" || !old.name.trim()) {
    throw new Error("旧版扩展清单缺少 id 或名称")
  }
  if (typeof old.version !== "string" || !valid(old.version)) throw new Error("旧版扩展版本无效")
  const profile = legacyProfile(old.id)
  const manifest: Record<string, unknown> = {
    manifestVersion: 3,
    id: old.id,
    name: old.name,
    version: old.version,
    icon: profile.icon,
    entry: "main.js",
    dependencies: { "@alwith/module-extension": "^0.1.2" },
    hosts: { "alwith-u": ">=0.1.1" },
    dataSchemaVersion: 1
  }
  for (const key of ["description", "author", "authorUrl"]) {
    const value = old[key]
    if (typeof value === "string" && value.trim()) manifest[key] = value.trim()
  }
  return manifest
}

/** Convert reviewed source as data: neither the loader nor business code runs during import. */
export async function convertLegacyExtension(prepared: PreparedLegacyImport): Promise<ConvertedLegacyImport> {
  const old = prepared.manifest
  const manifest = convertLegacyManifest(old)
  const id = String(manifest.id)
  const profile = legacyProfile(id)
  if ((await sha256(prepared.source)) !== profile.sourceSha256) {
    throw new Error("扩展代码与已审核版本不一致，请等待兼容配置更新")
  }
  const source = patchLegacySource(id, prepared.source)
  if ((await sha256(source)) !== profile.patchedSha256) throw new Error("旧版扩展兼容补丁校验失败")
  return {
    manifest,
    main: ENTRY_PREFIX + JSON.stringify({ manifest: old, source, styles: "styles.css" }) + ENTRY_SUFFIX
  }
}
