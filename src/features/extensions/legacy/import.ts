import type { JsonValue, PreparedImport } from "@/bindings"
export type PreparedLegacyImport = PreparedImport
export interface ConvertedLegacyImport {
  manifest: { [key: string]: JsonValue }
  main: string
}

const ENTRY_PREFIX =
  'module.exports.default = function(context) { return require("@alwith/module-extension/legacy").createLegacyExtension(context,'
const ENTRY_SUFFIX = "); };\n"

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
  // The native ticket owns source verification; staging rejects any changed payload.
  const source = prepared.source
  return {
    manifest,
    main:
      ENTRY_PREFIX +
      JSON.stringify({ manifest: old, source, styles: "styles.css", modules: prepared.modules }) +
      ENTRY_SUFFIX
  }
}
