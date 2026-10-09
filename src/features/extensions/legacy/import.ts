import type { JsonValue, PreparedImport } from "@/bindings"
import { findLegacyProfile } from "./profiles"
export type PreparedLegacyImport = PreparedImport
export interface ConvertedLegacyImport {
  manifest: { [key: string]: JsonValue }
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
  for (const patch of findLegacyProfile(id)?.patches ?? []) {
    if (source.split(patch.before).length !== 2) throw new Error("旧版扩展兼容补丁不匹配")
    source = source.replace(patch.before, () => patch.after)
  }
  return source
}

/** Native prepares the canonical manifest; business code remains data until activation. */
export async function convertLegacyExtension(prepared: PreparedLegacyImport): Promise<ConvertedLegacyImport> {
  const old = prepared.manifest
  const manifest = prepared.convertedManifest
  if (
    old === null ||
    typeof old !== "object" ||
    Array.isArray(old) ||
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  )
    throw new Error("扩展清单必须是 JSON 对象")
  if (typeof old.id !== "string" || manifest.id !== old.id) throw new Error("转换后的扩展 ID 不匹配")
  const id = String(manifest.id)
  const profile = findLegacyProfile(id)
  if (profile && (await sha256(prepared.source)) !== profile.sourceSha256) {
    throw new Error("扩展代码与已审核版本不一致，请等待兼容配置更新")
  }
  const source = patchLegacySource(id, prepared.source)
  if (profile && (await sha256(source)) !== profile.patchedSha256) throw new Error("旧版扩展兼容补丁校验失败")
  return {
    manifest,
    main:
      ENTRY_PREFIX +
      JSON.stringify({ manifest: old, source, styles: "styles.css", modules: prepared.modules }) +
      ENTRY_SUFFIX
  }
}
