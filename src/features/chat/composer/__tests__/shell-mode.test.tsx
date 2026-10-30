import { drafts } from "@alwith/module-chat/conversation"
import { createSession } from "@nyssance/codex-acp-v2/client"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { WorkspaceContext, type WorkspaceFileReference } from "@/features/workspace/context"
import { client } from "@/lib/client"
import i18n, { initI18n } from "@/lib/i18n"

import { Composer } from "../../__tests__/timeline-host"

await initI18n("en")
afterEach(() => {
  cleanup()
  drafts.clear()
  vi.restoreAllMocks()
})
const session = () => ({ ...createSession("shell-session", "/tmp"), attached: true })

test("a leading bang submits exact shell syntax to its session without prompting the model", async () => {
  const shell = vi.spyOn(client, "executeShell").mockResolvedValue(undefined)
  const submit = vi.fn()
  const view = render(<Composer session={session()} onSubmit={submit} />)
  const command = "printf 'a b\\n' | cat\n"
  fireEvent.change(screen.getByRole("textbox"), { target: { value: `!${command}` } })
  expect(view.container.querySelector("form")).toHaveAttribute("data-shell-mode", "true")
  expect(view.container.querySelector("[data-shell-prefix]")).toHaveTextContent("❗")
  expect(screen.getByRole("textbox")).toHaveValue(command)
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(shell).toHaveBeenCalledWith("shell-session", command))
  expect(submit).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""))
})

test("Escape exits shell mode while preserving the command as an ordinary draft", async () => {
  const shell = vi.spyOn(client, "executeShell").mockResolvedValue(undefined)
  const submit = vi.fn().mockResolvedValue(undefined)
  const view = render(<Composer session={session()} onSubmit={submit} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "!pwd" } })
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })
  expect(view.container.querySelector("form")).not.toHaveAttribute("data-shell-mode")
  expect(screen.getByRole("textbox")).toHaveValue("pwd")
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(submit).toHaveBeenCalledWith([{ type: "text", text: "pwd" }]))
  expect(shell).not.toHaveBeenCalled()
})

test("empty commands and shell execution during a running turn are blocked", () => {
  const view = render(<Composer session={session()} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "!" } })
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  view.rerender(<Composer session={{ ...session(), state: "running" }} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "pwd" } })
  expect(screen.getByRole("button", { name: i18n.t("composer.steer", { ns: "alwithChat" }) })).toBeDisabled()
})

test("failed command admission restores the shell draft", async () => {
  const shell = vi.spyOn(client, "executeShell").mockRejectedValue(new Error("Disconnected"))
  render(<Composer session={session()} />)
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "!pwd" } })
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() => expect(shell).toHaveBeenCalledOnce())
  await waitFor(() => {
    expect(drafts.get("shell-session")?.text).toBe("!pwd")
    expect(screen.getByRole("textbox")).toHaveValue("pwd")
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled()
  })
})

test("workspace references preserve the current draft, deduplicate files, and unregister on departure", async () => {
  let target: WorkspaceFileReference | null = null
  const stop = vi.fn(() => {
    target = null
  })
  const register = (next: WorkspaceFileReference) => {
    target = next
    return stop
  }
  const submit = vi.fn().mockResolvedValue(undefined)
  const view = render(
    <WorkspaceContext
      value={{
        visible: false,
        toggle: vi.fn(),
        openFile: vi.fn(),
        openProject: vi.fn(),
        revealEntry: vi.fn(),
        registerFileReference: register
      }}
    >
      <Composer session={session()} onSubmit={submit} />
    </WorkspaceContext>
  )
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Review this file" } })
  act(() => {
    target?.add("/tmp/example.ts")
    target?.add("/tmp/example.ts")
  })
  expect(screen.getByRole("textbox")).toHaveValue("Review this file")
  expect(screen.getAllByText("example.ts")).toHaveLength(1)
  fireEvent.click(screen.getByRole("button", { name: "Send" }))
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith([
      expect.objectContaining({ type: "resource_link", name: "example.ts" }),
      { type: "text", text: "Review this file" }
    ])
  )
  view.unmount()
  expect(stop).toHaveBeenCalled()
  expect(target).toBeNull()
})
