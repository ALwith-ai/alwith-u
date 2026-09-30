import { afterEach, expect, test } from "bun:test"
import { act, fireEvent, render, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { initI18n } from "@/lib/i18n"
import { installDom } from "../../codex/__tests__/dom-environment"
import { PromptInputAttachment, PromptInputAttachments } from "../prompt-input-attachments"
import { type Attachment, PromptInputProvider } from "../prompt-input-context"

installDom()
await initI18n("en")
const mounted: ReturnType<typeof render>[] = []
afterEach(async () => {
  await act(async () => {
    for (const view of mounted.splice(0)) view.unmount()
  })
})

function Draft() {
  const [files, setFiles] = useState<Attachment[]>([
    { id: "photo", type: "file", filename: "photo.png", mediaType: "image/png", url: "data:image/png;base64,aA==" }
  ])
  return (
    <PromptInputProvider attachments={files} onAttachmentsChange={setFiles}>
      <PromptInputAttachments>{data => <PromptInputAttachment data={data} />}</PromptInputAttachments>
    </PromptInputProvider>
  )
}

test("U attachment uses Desktop's zoomable preview and U translations", async () => {
  const view = render(<Draft />)
  mounted.push(view)
  fireEvent.click(view.getByRole("button", { name: "Image" }))
  const dialog = await within(document.body).findByRole("dialog", { name: "photo.png" })
  expect(within(dialog).getByRole("img").getAttribute("src")).toBe("data:image/png;base64,aA==")
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
  await waitFor(() => expect(within(document.body).queryByRole("dialog")).toBeNull())
  fireEvent.click(view.getByRole("button", { name: "Remove attachment" }))
  expect(view.queryByRole("button", { name: "Image" })).toBeNull()
})
