import { type ActivityHost, ActivityHostProvider } from "@alwith/module-chat/activity-host"
import { CodexMessageActions } from "@alwith/module-chat/assistant-message"
import { CodexUserMessage, CopyAction } from "@alwith/module-chat/user-message"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

afterEach(cleanup)

test("copy confirmation waits for the host clipboard operation", async () => {
  let complete!: () => void
  const copyText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      })
  )
  const view = render(<CopyAction text="Exact message" label="Copy" host={{ copyText }} />)
  fireEvent.click(view.getByRole("button", { name: "Copy" }))
  expect(copyText).toHaveBeenCalledWith("Exact message")
  expect(view.container.querySelector(".codex-message-action-confirmed")).toBeNull()
  await act(async () => complete())
  expect(view.container.querySelector(".codex-message-action-confirmed")).not.toBeNull()
})

test("a failed clipboard write reports failure without confirming the copy", async () => {
  const error = new Error("Clipboard unavailable")
  const onCopyError = vi.fn()
  const view = render(
    <CopyAction
      text="Message"
      label="Copy"
      host={{
        copyText: async () => {
          throw error
        },
        onCopyError
      }}
    />
  )
  fireEvent.click(view.getByRole("button", { name: "Copy" }))
  await waitFor(() => expect(onCopyError).toHaveBeenCalledWith(error))
  expect(view.container.querySelector(".codex-message-action-confirmed")).toBeNull()
})

test("both user and assistant copy actions reach the supplied host clipboard", async () => {
  const copyText = vi.fn(() => Promise.resolve())
  const host: ActivityHost = {
    t: (key) => key,
    i18n: { language: "en" },
    openLink: () => {},
    Markdown: ({ text }) => <span>{text}</span>,
    copyText
  }
  const view = render(
    <ActivityHostProvider host={host}>
      <CodexUserMessage
        host={host}
        message={{ id: "message" }}
        text="User text"
        mentions={[]}
        images={[]}
        messageTime={null}
      />
      <CodexMessageActions text="Assistant text" />
    </ActivityHostProvider>
  )
  const buttons = view.getAllByRole("button", { name: "actions.copy" })
  fireEvent.click(buttons[0])
  fireEvent.click(buttons[1])
  await waitFor(() => expect(copyText.mock.calls).toEqual([["User text"], ["Assistant text"]]))
})
