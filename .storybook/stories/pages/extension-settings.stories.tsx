import { Setting } from "@alwith/module-extension/plugin"
import { useEffect, useState } from "react"
import type { ComponentProps } from "react"

import { ExtensionSettingsControls } from "../../../src/features/extensions/extension-settings-controls"
import preview from "../../preview"
import type { SharedMeta } from "../page-meta"
import "../../../src/features/settings/settings.css"
import "../../../src/features/extensions/legacy/styles.css"

export function ExtensionSettingsPreview() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!container) return
    new Setting(container)
      .setName("环境")
      .setDesc("选择服务环境，切换后由扩展保存。")
      .addDropdown((control) =>
        control
          .addOptions({ qa: "QA", test: "Test", prod: "Production" })
          .setValue("qa")
          .onChange(() => {})
      )
    new Setting(container)
      .setName("API 域名")
      .setDesc("使用 HTTPS 反向代理时填写域名。")
      .addText((control) => {
        control.setValue("example.com")
        control.inputEl.setAttribute("aria-label", "API 域名")
      })
    new Setting(container)
      .setName("使用 HTTPS")
      .setDesc("开启安全连接。")
      .addToggle((control) => control.setValue(true).onChange(() => {}))
    const status = document.createElement("div")
    status.textContent = "AI 对话归档同步：未启用"
    container.append(status)
    return () => container.replaceChildren()
  }, [container])
  return (
    <section className="settings-content mx-auto w-full max-w-3xl p-6">
      <h1 className="text-sm font-medium">扩展设置</h1>
      <style>
        {
          ".alwith-legacy .setting-item button {padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--background)}"
        }
      </style>
      <div ref={setContainer} className="alwith-legacy legacy-settings" />
      {container && <ExtensionSettingsControls container={container} />}
    </section>
  )
}
export const pageMeta = {} satisfies SharedMeta<ComponentProps<typeof ExtensionSettingsPreview>>

// pageMeta is shared with derived files, not a story.
const meta = preview.meta({
  title: "页面/设置页/扩展控件",
  excludeStories: ["pageMeta", "ExtensionSettingsPreview"],
  component: ExtensionSettingsPreview,
  ...pageMeta
})
export const Default = meta.story({ name: "默认控件" })
