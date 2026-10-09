import { afterEach, expect, test } from "bun:test"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import i18n, { initI18n } from "@/lib/i18n"
import { petWindowCall } from "../window-client"

installDom()
afterEach(clearMocks)

test("native context menus read the current language each time they open", async () => {
  const requests: unknown[] = []
  mockIPC((command, args) => {
    expect(command).toBe("vibemon_window")
    requests.push(args)
    return null
  })
  await initI18n("zh-CN")
  await petWindowCall("menu")
  await i18n.changeLanguage("en")
  await petWindowCall("menu")
  expect(requests).toEqual([
    { action: "menu", payload: { closeLabel: "关闭桌宠" } },
    { action: "menu", payload: { closeLabel: "Close desktop pet" } }
  ])
})
