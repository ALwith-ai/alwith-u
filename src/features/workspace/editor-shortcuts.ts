import type { MonacoAction } from "@alwith/module-editor/monaco"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

function focusedEditor(): HTMLElement | null {
  return document.activeElement?.closest(".alwith-editor")?.querySelector<HTMLElement>("[data-code-editor]") ?? null
}
function requestEditorAction(action: MonacoAction): void {
  window.dispatchEvent(new CustomEvent<MonacoAction>("workspace:editor-action", { detail: action }))
}
export function routeFind(openChat: () => void): void {
  if (focusedEditor()) requestEditorAction("find")
  else openChat()
}
export function routeReplace(): void {
  if (focusedEditor()) requestEditorAction("replace")
}
export function routeHistory(action: "undo" | "redo"): void {
  if (focusedEditor()) requestEditorAction(action)
  else {
    const focused = document.activeElement
    const inline = focused?.closest("[data-inline-input]")
    if (inline) {
      inline.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: action === "undo" ? "historyUndo" : "historyRedo",
          bubbles: true,
          cancelable: true
        })
      )
      return
    }
    const richEditor = focused?.closest<HTMLElement>(".alwith-preview-markdown .ProseMirror")
    if (richEditor) {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform)
      richEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          keyCode: 90,
          metaKey: mac,
          ctrlKey: !mac,
          shiftKey: action === "redo",
          bubbles: true,
          cancelable: true
        })
      )
    } else document.execCommand(action)
  }
}

export async function listenForEditHistory(): Promise<void> {
  const webview = getCurrentWebviewWindow()
  await Promise.all([
    webview.listen("menu:edit-undo", () => routeHistory("undo")),
    webview.listen("menu:edit-redo", () => routeHistory("redo"))
  ])
}
