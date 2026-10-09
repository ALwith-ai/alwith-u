import { useDirection } from "@base-ui/react/direction-provider"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { createPortal } from "react-dom"
import { afterEach, expect, test } from "vitest"
import i18n, { initI18n } from "@/lib/i18n"
import { AppDirectionProvider } from "../app-direction-provider"

afterEach(cleanup)

function PortalDirection() {
  const direction = useDirection()
  return createPortal(<output data-testid="portal-direction">{direction}</output>, document.body)
}

test("Arabic selects RTL for the document and portalled Base UI components", async () => {
  await initI18n("ar")
  render(
    <AppDirectionProvider>
      <PortalDirection />
    </AppDirectionProvider>
  )

  await waitFor(() => {
    expect(document.documentElement.lang).toBe("ar")
    expect(document.documentElement.dir).toBe("rtl")
    expect(document.body).toContainOneByText("rtl")
  })

  await act(() => i18n.changeLanguage("en"))
  await waitFor(() => {
    expect(document.documentElement.lang).toBe("en")
    expect(document.documentElement.dir).toBe("ltr")
    expect(document.body).toContainOneByText("ltr")
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
