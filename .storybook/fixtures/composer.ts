import { filterFiles } from "@alwith/module-chat/completion-filter"

import { virtualFiles } from "./filesystem"
import { client } from "./client"

export type ComposerCase =
  "ready" | "textPending" | "textError" | "mentionEmpty" | "mentionError" | "prediction"
let textFault: "pending" | "error" | null = null
export function consumeTextAttachmentFault() {
  const result = textFault
  if (result === "error") textFault = null
  return result
}
export function resetComposer(kind: ComposerCase = "ready"): void {
  textFault = kind === "textPending" ? "pending" : kind === "textError" ? "error" : null
  client.fuzzyFileSearch = ({ query, roots }) => {
    if (kind === "mentionError") return Promise.reject(new Error("模拟文件搜索失败"))
    return Promise.resolve({
      files: roots.flatMap((root) => {
        const prefix = `${root.replace(/\/$/, "")}/`
        const paths = [...virtualFiles.keys()].filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length))
        return filterFiles(paths, query, root).map((item) => ({
          root,
          path: item.label,
          file_name: item.label.slice(item.label.lastIndexOf("/") + 1),
          match_type: "file" as const,
          score: 0,
          indices: null
        }))
      }).slice(0, 50)
    })
  }
}
