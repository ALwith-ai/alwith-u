import * as monaco from "monaco-editor"
import EditorWorker from "monaco-editor/editor/editor.worker?worker"
import JsonWorker from "monaco-editor/language/json/json.worker?worker"
import CssWorker from "monaco-editor/language/css/css.worker?worker"
import HtmlWorker from "monaco-editor/language/html/html.worker?worker"
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker"
import { createMonacoEngine } from "@alwith/module-editor/monaco"
import type { EditorController, TextEditorProps } from "@alwith/module-editor"
import { useEffect, useMemo, useRef } from "react"
import { useTheme } from "@/components/theme-provider"
import type { MonacoAction } from "@alwith/module-editor/monaco"
import type { EditorSettings } from "./editor-settings"
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === "json") return new JsonWorker()
    if (["css", "scss", "less"].includes(label)) return new CssWorker()
    if (["html", "handlebars", "razor"].includes(label)) return new HtmlWorker()
    if (["typescript", "javascript"].includes(label)) return new TsWorker()
    return new EditorWorker()
  }
}
const engines = new WeakMap<EditorController, ReturnType<typeof createMonacoEngine>>()
export function releaseMonaco(controller: EditorController): void {
  const engine = engines.get(controller)
  if (engine) {
    engine.dispose()
    engines.delete(controller)
  }
}
export default function CodeEditor(
  props: TextEditorProps & { controller: EditorController; settings: EditorSettings; onError: (error: unknown) => void }
) {
  const { resolvedTheme } = useTheme()
  const element = useRef<HTMLDivElement>(null)
  const engine = useMemo(() => {
    let value = engines.get(props.controller)
    if (!value) {
      value = createMonacoEngine(monaco, props.controller)
      engines.set(props.controller, value)
    }
    return value
  }, [props.controller])
  const options = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      fontSize: props.settings.fontSize,
      fontFamily: props.settings.fontFamily || undefined,
      fontLigatures: props.settings.fontLigatures,
      minimap: { enabled: props.settings.minimap },
      wordWrap: props.settings.wordWrap ? "on" : "off",
      lineNumbers: props.settings.lineNumbers ? "on" : "off",
      renderWhitespace: props.settings.renderWhitespace ? "all" : "none"
    }),
    [props.settings]
  )
  useEffect(() => {
    const run = (event: Event): void => {
      if (!element.current?.closest(".alwith-editor")?.contains(document.activeElement)) return
      void engine.runAction((event as CustomEvent<MonacoAction>).detail).catch(props.onError)
    }
    const keydown = (event: KeyboardEvent): void => {
      if (!element.current?.contains(document.activeElement) || !(event.metaKey || event.ctrlKey)) return
      const action =
        event.key.toLowerCase() === "g"
          ? "goto-line"
          : event.key.toLowerCase() === "f" && event.altKey
            ? "replace"
            : null
      if (action) {
        event.preventDefault()
        void engine.runAction(action).catch(props.onError)
      }
    }
    window.addEventListener("workspace:editor-action", run)
    window.addEventListener("keydown", keydown)
    return () => {
      window.removeEventListener("workspace:editor-action", run)
      window.removeEventListener("keydown", keydown)
    }
  }, [engine, props.onError])
  return (
    <div ref={element} data-code-editor className="h-full">
      <engine.Editor {...props} theme={resolvedTheme} options={options} />
    </div>
  )
}
