import type { PreviewHost } from "@alwith/module-editor/previews"

// Browser URLs replace only the native preview-html protocol.
export function createHtmlPreviewHost(): NonNullable<PreviewHost["htmlPreview"]> {
  return {
    open: (_path, source) => {
      const url = URL.createObjectURL(new Blob([source], { type: "text/html" }))
      return Promise.resolve({ url, dispose: () => Promise.resolve(URL.revokeObjectURL(url)) })
    },
    subscribe: () => Promise.resolve(() => {})
  }
}
