import type { PreviewHost } from "@alwith/module-editor/previews"

// Browser URLs replace only the native preview-html protocol.
export function createHtmlPreviewHost(): NonNullable<PreviewHost["htmlPreview"]> {
  return {
    open: async (_path, source) => {
      const url = URL.createObjectURL(new Blob([source], { type: "text/html" }))
      return { url, dispose: async () => URL.revokeObjectURL(url) }
    },
    subscribe: async () => () => {}
  }
}
