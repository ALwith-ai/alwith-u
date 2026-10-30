import catalog from "../../src-tauri/resources/custom/models.json"

/** Use the same capability record as the native host, independent of provider labels. */
export function customModelEffort(model: string | null): { value: string; hidden: boolean } | null {
  const match = model?.match(/^gateway:custom-[^:]+:(.+)$/)
  if (!match) return null
  const slug = decodeURIComponent(match[1])
  const metadata = catalog.models.find((entry) => entry.slug === slug)
  return metadata
    ? {
        value: metadata.default_reasoning_level,
        hidden: metadata.supported_reasoning_levels.length === 0
      }
    : null
}
