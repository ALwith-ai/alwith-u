import { defaultValueCtx, Editor, rootCtx } from "@milkdown/core"
import { history } from "@milkdown/plugin-history"
import { commonmark } from "@milkdown/preset-commonmark"
import { gfm } from "@milkdown/preset-gfm"

const document_ = [
  "# 错数登记簿",
  "",
  "笔记写自己占 **28～52%**，风控 48～72%。",
  "",
  "回归：通过，再次通过。",
  "",
  "| 项目 | 结论 |",
  "| --- | --- |",
  "| 月报 | 自己占 28% |",
  "| 周报 | 通过 |",
  ""
].join("\n")

await Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, document.querySelector("#editor"))
    ctx.set(defaultValueCtx, document_)
  })
  .use(commonmark)
  .use(gfm)
  .use(history)
  .create()
document.body.dataset.ready = "true"
