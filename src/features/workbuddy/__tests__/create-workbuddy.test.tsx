import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"

const { invoke, chooseFolder } = vi.hoisted(() => ({ invoke: vi.fn(), chooseFolder: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: { workbuddyCreate: invoke } }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }))
vi.mock("@/features/chat/draft-project-picker", () => ({ chooseFolder }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { CreateWorkBuddy } from "../create-workbuddy"

beforeEach(() => {
  invoke.mockReset()
  chooseFolder.mockReset()
  chooseFolder.mockResolvedValue("/projects")
})

async function fill(onCreated = vi.fn()) {
  render(<CreateWorkBuddy onCreated={onCreated} />)
  fireEvent.click(screen.getByRole("button", { name: "workbuddy.create" }))
  const dialog = await screen.findByRole("dialog")
  const view = within(dialog)
  fireEvent.change(view.getByLabelText("workbuddy.productName"), { target: { value: "My Buddy" } })
  fireEvent.change(view.getByLabelText("workbuddy.packageName"), { target: { value: "my-buddy" } })
  fireEvent.change(view.getByLabelText("workbuddy.identifier"), { target: { value: "com.example.buddy" } })
  fireEvent.click(view.getByRole("button", { name: "workbuddy.chooseFolder" }))
  await waitFor(() => expect(view.getByLabelText("workbuddy.parent")).toHaveValue("/projects"))
  return { form: dialog.querySelector("form")!, onCreated }
}

test("one submission opens exactly the generated project and does not duplicate an in-flight operation", async () => {
  let complete!: (directory: string) => void
  invoke.mockReturnValue(
    new Promise<string>((resolve) => {
      complete = resolve
    })
  )
  const { form, onCreated } = await fill()
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(invoke).toHaveBeenCalledWith({
    parent: "/projects",
    name: "my-buddy",
    productName: "My Buddy",
    identifier: "com.example.buddy",
    auth: "alwith"
  })
  await act(async () => complete("/projects/my-buddy"))
  expect(onCreated).toHaveBeenCalledExactlyOnceWith("/projects/my-buddy")
})

test("a generation error is displayed without another invocation or opening a project", async () => {
  invoke.mockRejectedValue("The output directory already exists")
  const { form, onCreated } = await fill()
  fireEvent.submit(form)
  expect(await screen.findByRole("alert")).toHaveTextContent("The output directory already exists")
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(onCreated).not.toHaveBeenCalled()
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
})

test("bare chat explicitly disables ALwith integration", async () => {
  invoke.mockResolvedValue("/projects/my-buddy")
  const { form, onCreated } = await fill()
  fireEvent.click(screen.getByRole("switch", { name: "workbuddy.auth" }))
  fireEvent.submit(form)
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
  expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ auth: "none" }))
})
