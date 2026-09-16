import { afterEach, expect, test } from "bun:test"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { installDom } from "../../codex/__tests__/dom-environment"
import { PromptInput, PromptInputProvider, PromptInputSubmit, PromptInputTextarea } from "../prompt-input"

installDom()
const mounted: ReturnType<typeof render>[] = []
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount()
})

test("U consumes Desktop's shared form without enabling Desktop dev commands or bash mode", async () => {
  const messages: string[] = []
  const view = render(
    <PromptInputProvider initialInput="/dev open">
      <PromptInput
        onSubmit={({ text }) => {
          messages.push(text)
        }}>
        <PromptInputTextarea aria-label="message" />
        <PromptInputSubmit />
      </PromptInput>
    </PromptInputProvider>
  )
  mounted.push(view)
  fireEvent.click(view.getByRole("button", { name: "Submit" }))
  await waitFor(() => expect(messages).toEqual(["/dev open"]))
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("")
})

test("U preserves literal exclamation marks and the common form's submit button", async () => {
  const messages: string[] = []
  const view = render(
    <PromptInputProvider initialInput="!hello">
      <PromptInput
        onSubmit={({ text }) => {
          messages.push(text)
        }}>
        <PromptInputTextarea aria-label="message" />
        <PromptInputSubmit />
      </PromptInput>
    </PromptInputProvider>
  )
  mounted.push(view)
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("!hello")
  const surface = view.container.querySelector("[data-slot=input-group]")!
  expect(surface.className).not.toContain("border-[rgb")
  fireEvent.click(view.getByRole("button", { name: "Submit" }))
  await waitFor(() => expect(messages).toEqual(["!hello"]))
})
