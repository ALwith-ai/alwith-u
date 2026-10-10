import type { PreviewHost } from "@alwith/module-editor/previews"
import { containsPath, dirname, type FileSystem } from "@alwith/module-fs/core"

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>

/** Native capabilities share the workspace's authorization and existing filesystem watcher. */
export function createHtmlPreviewHost(
  root: string,
  fs: FileSystem,
  invoke: Invoke,
  windows: boolean
): NonNullable<PreviewHost["htmlPreview"]> {
  return {
    async open(path, source) {
      const result = await invoke("html_preview_open", { root, path, source })
      if (
        result === null ||
        typeof result !== "object" ||
        !("token" in result) ||
        !("path" in result) ||
        typeof result.token !== "string" ||
        typeof result.path !== "string"
      )
        throw new Error("Invalid native HTML preview response")
      const token = result.token
      const resource = [token, ...result.path.split("/")].map(encodeURIComponent).join("/")
      return {
        url: `${windows ? "http://preview-html.localhost" : "preview-html://localhost"}/${resource}`,
        async dispose() {
          await invoke("html_preview_close", { token })
        }
      }
    },
    async subscribe(path, onChange) {
      const directory = dirname(path)
      return fs.subscribe(change => {
        const paths =
          change.type === "change" ? change.paths : "to" in change ? [change.path, change.to] : [change.path]
        if (paths.some(changed => containsPath(directory, changed) || containsPath(changed, directory))) onChange()
      })
    }
  }
}
