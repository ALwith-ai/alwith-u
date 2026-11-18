import type { PreviewHost } from "@alwith/module-editor/previews"
import { containsPath, dirname, type FileSystem } from "@alwith/module-fs/core"
import { convertFileSrc } from "@tauri-apps/api/core"

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>

/** Native capabilities share the workspace's authorization and existing filesystem watcher. */
export function createHtmlPreviewHost(
  root: string,
  fs: FileSystem,
  invoke: Invoke
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
      const base = convertFileSrc(token, "preview-html")
      const resource = result.path.split("/").map(encodeURIComponent).join("/")
      return {
        url: `${base}/${resource}`,
        async dispose() {
          await invoke("html_preview_close", { token })
        }
      }
    },
    subscribe(path, onChange) {
      return Promise.try(() => {
        const directory = dirname(path)
        return fs.subscribe((change) => {
          const paths =
            change.type === "change" ? change.paths : "to" in change ? [change.path, change.to] : [change.path]
          if (paths.some((changed) => containsPath(directory, changed) || containsPath(changed, directory))) onChange()
        })
      })
    }
  }
}
