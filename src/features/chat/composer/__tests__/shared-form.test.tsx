import { fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { must } from "@/lib/__tests__/must"

import { PromptInput, PromptInputProvider, PromptInputSubmit, PromptInputTextarea } from "../prompt-input"

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
        }}
      >
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
        }}
      >
        <PromptInputTextarea aria-label="message" />
        <PromptInputSubmit />
      </PromptInput>
    </PromptInputProvider>
  )
  mounted.push(view)
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("!hello")
  const surface = must(view.container.querySelector("[data-slot=input-group]"), "the input group")
  expect(surface.className).not.toContain("border-[rgb")
  fireEvent.click(view.getByRole("button", { name: "Submit" }))
  await waitFor(() => expect(messages).toEqual(["!hello"]))
})

test("shared form serializes submission until asynchronous preparation and acceptance finish", async () => {
  let finish = () => {}
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const messages: string[] = []
  const view = render(
    <PromptInputProvider initialInput="image prompt">
      <PromptInput
        onSubmit={async ({ text }) => {
          messages.push(text)
          await pending
        }}
      >
        <PromptInputTextarea aria-label="message" />
        <PromptInputSubmit />
      </PromptInput>
    </PromptInputProvider>
  )
  mounted.push(view)
  const form = must(view.container.querySelector("form"), "form")
  fireEvent.submit(form)
  fireEvent.submit(form)
  await waitFor(() => expect(messages).toEqual(["image prompt"]))
  fireEvent.submit(form)
  expect(messages).toHaveLength(1)
  finish()
  await waitFor(() => expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""))
  fireEvent.change(view.getByRole("textbox"), { target: { value: "next prompt" } })
  fireEvent.submit(form)
  await waitFor(() => expect(messages).toEqual(["image prompt", "next prompt"]))
})

test("failed submission preserves the draft and releases the submission lock for retry", async () => {
  let attempts = 0
  const view = render(
    <PromptInputProvider initialInput="retry me">
      <PromptInput
        onSubmit={() => {
          return Promise.try(() => {
            if (++attempts === 1) throw new Error("offline")
          })
        }}
      >
        <PromptInputTextarea aria-label="message" />
        <PromptInputSubmit />
      </PromptInput>
    </PromptInputProvider>
  )
  mounted.push(view)
  const form = must(view.container.querySelector("form"), "form")
  fireEvent.submit(form)
  await waitFor(() => expect(attempts).toBe(1))
  expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe("retry me")
  fireEvent.submit(form)
  await waitFor(() => expect(attempts).toBe(2))
  await waitFor(() => expect((view.getByRole("textbox") as HTMLTextAreaElement).value).toBe(""))
})
