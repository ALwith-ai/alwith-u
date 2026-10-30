import { PROJECT_DIRECTORY } from "./catalog"
import { actionsTaken, client } from "./client"

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
  client.fuzzyFileSearch = async ({ query }) => {
    if (kind === "mentionError") throw new Error("模拟文件搜索失败")
    return {
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
    }
  }
  client.requestPrediction = async (id, sourceTurnId) => {
    actionsTaken.push({ type: "prediction", id })
    if (kind === "predictionError") throw new Error("模拟输入预测服务不可用")
    if (kind !== "prediction") return
    const session = client.session(id)
    client.store.setState((state) => ({
      sessions: {
        ...state.sessions,
        [id]: {
          ...session,
          _meta: { codex: { prediction: { sourceTurnId, result: { type: "completed", text: "请继续核对文件预览" } } } }
        }
      }
    }))
  }
}
