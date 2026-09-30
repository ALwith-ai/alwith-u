import { expect, test } from "bun:test"
import { render, waitFor } from "@testing-library/react"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import { initI18n } from "@/lib/i18n"
import { AppDirectionProvider } from "../app-direction-provider"

installDom()

test("an incomplete RTL locale uses the English content language and LTR layout", async () => {
  await initI18n("ar")
  render(
    <AppDirectionProvider>
      <div>content</div>
    </AppDirectionProvider>
  )

  await waitFor(() => {
    expect(document.documentElement.lang).toBe("en")
    expect(document.documentElement.dir).toBe("ltr")
  })
})

test("Simplified Chinese keeps its own content language", async () => {
  await initI18n("zh-CN")
  render(
    <AppDirectionProvider>
      <div>内容</div>
    </AppDirectionProvider>
  )

  await waitFor(() => {
    expect(document.documentElement.lang).toBe("zh-CN")
    expect(document.documentElement.dir).toBe("ltr")
  })
})
