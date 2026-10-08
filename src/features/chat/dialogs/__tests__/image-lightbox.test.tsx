import { afterEach, expect, test } from "bun:test"
import { act, fireEvent, render, waitFor, within } from "@testing-library/react"
import { initI18n } from "@/lib/i18n"
import { installDom } from "../../codex/__tests__/dom-environment"
import { ImageLightbox, openImageLightbox } from "../image-lightbox"

installDom()
await initI18n("en")
const mounted: Array<ReturnType<typeof render>> = []
afterEach(async () => {
  await act(async () => {
    for (const view of mounted.splice(0)) view.unmount()
  })
})

test("image previews expose a visible close button and still close with Escape", async () => {
  const view = render(
    <>
      <button type="button" onClick={() => openImageLightbox("data:image/png;base64,test", "Portrait")}>
        Preview
      </button>
      <ImageLightbox />
    </>
  )
  mounted.push(view)
  fireEvent.click(view.getByRole("button", { name: "Preview" }))
  const dialog = view.getByRole("dialog")
  expect(dialog.querySelector("img")?.alt).toBe("Portrait")
  const close = within(dialog).getByRole("button", { name: "Close" })
  expect(close.querySelector("svg")).not.toBeNull()
  fireEvent.click(close)
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
  fireEvent.click(view.getByRole("button", { name: "Preview" }))
  fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" })
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
}, 15_000)
