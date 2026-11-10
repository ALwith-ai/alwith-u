const localFields = new Set([
  "inputMode",
  "imageIntent",
  "imageInstructions",
  "imageSelection",
  "imageRequestId",
  "imageAspectRatio"
])

/** Mode-specific options are consumed by U; only execution parameters cross the adapter boundary. */
export function executionMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const alwith = meta?.alwith
  if (!alwith || typeof alwith !== "object" || Array.isArray(alwith)) return meta
  return { ...meta, alwith: Object.fromEntries(Object.entries(alwith).filter(([key]) => !localFields.has(key))) }
}
