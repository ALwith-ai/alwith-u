import { EditorView } from "@codemirror/view"

new EditorView({
  doc: "Original draft",
  extensions: [EditorView.lineWrapping],
  parent: document.querySelector("#editor") as HTMLElement
})
