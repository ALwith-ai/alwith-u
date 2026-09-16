import { PromptInputProvider, usePromptInputController } from "@alwith/chat/composer-context"
import { fireEvent, render } from "@testing-library/react"
import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { installDom } from "../../codex/__tests__/dom-environment"

installDom()
const mounted: Array<ReturnType<typeof render>> = []
afterEach(() => { for (const view of mounted.splice(0)) view.unmount() })

function Draft() {
  const { textInput, attachments } = usePromptInputController()
  return <>
    <textarea aria-label="Draft" value={textInput.value} readOnly />
    <button type="button" onClick={() => textInput.setInput("Edited")}>Edit draft</button>
    <output>{attachments.files.map(file => file.filename).join(",")}</output>
  </>
}

test("shared Desktop controller takes each session's controlled draft without copying it", () => {
  const onValueChange = mock(() => {})
  const onAttachmentsChange = mock(() => {})
  const view = render(<PromptInputProvider value="First session" onValueChange={onValueChange}
    attachments={[]} onAttachmentsChange={onAttachmentsChange}><Draft /></PromptInputProvider>)
  mounted.push(view)
  fireEvent.click(view.getByRole("button", { name: "Edit draft" }))
  expect(onValueChange).toHaveBeenCalledWith("Edited")
  view.rerender(<PromptInputProvider value="Second session" onValueChange={onValueChange}
    attachments={[]} onAttachmentsChange={onAttachmentsChange}><Draft /></PromptInputProvider>)
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Second session")
})

test("unmount does not revoke attachment URLs owned by the session draft", () => {
  const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  try {
    const view = render(<PromptInputProvider value="" onValueChange={() => {}}
      attachments={[{ id: "image", type: "file", filename: "a.png", mediaType: "image/png", url: "blob:owned" }]}
      onAttachmentsChange={() => {}}><Draft /></PromptInputProvider>)
    mounted.push(view)
    view.unmount()
    expect(revoke).not.toHaveBeenCalled()
  } finally {
    revoke.mockRestore()
  }
})
