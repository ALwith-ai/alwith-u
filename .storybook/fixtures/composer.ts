import { PROJECT_DIRECTORY } from "./catalog"
import { client } from "./client"

export type ComposerCase =
  "ready" | "textPending" | "textError" | "mentionEmpty" | "mentionError" | "prediction" | "predictionError"
let textFault: "pending" | "error" | null = null
export function consumeTextAttachmentFault() {
  const result = textFault
  if (result === "error") textFault = null
  return result
}
export function resetComposer(kind: ComposerCase = "ready"): void {
  textFault = kind === "textPending" ? "pending" : kind === "textError" ? "error" : null
  client.fuzzyFileSearch = ({ query }) => {
    if (kind === "mentionError") return Promise.reject(new Error("模拟文件搜索失败"))
    return Promise.resolve({
      files:
        kind === "mentionEmpty"
          ? []
          : ["README.md", "docs/交付清单.md"]
              .filter((path) => path.toLowerCase().includes(query.toLowerCase()))
              .map((path) => ({
                root: PROJECT_DIRECTORY,
                path,
                file_name: path.split("/").at(-1)!,
                match_type: "file" as const,
                score: 100,
                indices: null
              }))
    })
  }
}
