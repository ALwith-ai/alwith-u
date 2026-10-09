import { PromptInputProvider, usePromptInputController } from "@alwith/module-chat/composer-context"
import { fireEvent, render } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

const mounted: Array<ReturnType<typeof render>> = []
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount()
})

function Draft() {
  const { textInput, attachments } = usePromptInputController()
  return (
    <>
      <textarea aria-label="Draft" value={textInput.value} readOnly />
      <button type="button" onClick={() => textInput.setInput("Edited")}>
        Edit draft
      </button>
      <output>{attachments.files.map(file => file.filename).join(",")}</output>
    </>
  )
}

test("shared Desktop controller takes each session's controlled draft without copying it", () => {
  const onValueChange = vi.fn(() => {})
  const onAttachmentsChange = vi.fn(() => {})
  const view = render(
    <PromptInputProvider
      value="First session"
      onValueChange={onValueChange}
      attachments={[]}
      onAttachmentsChange={onAttachmentsChange}>
      <Draft />
    </PromptInputProvider>
  )
  mounted.push(view)
  fireEvent.click(view.getByRole("button", { name: "Edit draft" }))
  expect(onValueChange).toHaveBeenCalledWith("Edited")
  view.rerender(
    <PromptInputProvider
      value="Second session"
      onValueChange={onValueChange}
      attachments={[]}
      onAttachmentsChange={onAttachmentsChange}>
      <Draft />
    </PromptInputProvider>
  )
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Second session")
})

test("unmount does not revoke attachment URLs owned by the session draft", () => {
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  try {
    const view = render(
      <PromptInputProvider
        value=""
        onValueChange={() => {}}
        attachments={[{ id: "image", type: "file", filename: "a.png", mediaType: "image/png", url: "blob:owned" }]}
        onAttachmentsChange={() => {}}>
        <Draft />
      </PromptInputProvider>
    )
    mounted.push(view)
    view.unmount()
    expect(revoke).not.toHaveBeenCalled()
  } finally {
    revoke.mockRestore()
  }
})
