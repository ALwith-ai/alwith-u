import { act, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { expect, test } from "vitest"
import { type Attachment, PromptInputProvider } from "../prompt-input-context"
import { PromptInputTextarea } from "../prompt-input"

function Input() {
  const [files, setFiles] = useState<Attachment[]>([
    { id: "photo", type: "file", filename: "photo.png", mediaType: "image/png", url: "data:image/png;base64,aA==" }
  ])
  return (
    <PromptInputProvider attachments={files} onAttachmentsChange={setFiles}>
      <PromptInputTextarea aria-label="message" />
      <output>{files.length}</output>
    </PromptInputProvider>
  )
}

test("IME deletion preserves images through composition and the WebKit confirmation frame", async () => {
  const view = render(<Input />)
  const input = view.getByRole("textbox")
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: "n" } })
  fireEvent.change(input, { target: { value: "" } })
  fireEvent.keyDown(input, { key: "Backspace" })
  expect(view.getByRole("status")).toHaveTextContent("1")
  fireEvent.compositionEnd(input)
  fireEvent.keyDown(input, { key: "Backspace" })
  expect(view.getByRole("status")).toHaveTextContent("1")
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
  fireEvent.keyDown(input, { key: "Backspace", isComposing: true })
  fireEvent.keyDown(input, { key: "Backspace", keyCode: 229 })
  expect(view.getByRole("status")).toHaveTextContent("1")
  fireEvent.change(input, { target: { value: "你" } })
  fireEvent.keyDown(input, { key: "Backspace" })
  expect(view.getByRole("status")).toHaveTextContent("1")
  fireEvent.change(input, { target: { value: "" } })
  fireEvent.keyDown(input, { key: "Backspace" })
  expect(view.getByRole("status")).toHaveTextContent("0")
})
