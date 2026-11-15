import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, test, vi } from "vitest"
import { RuntimeRow } from "../runtime-row"
const { capabilities, invoke } = vi.hoisted(() => ({ capabilities: vi.fn(), invoke: vi.fn() }))
vi.mock("@/lib/runtime-capabilities", () => ({ useRuntimeCapabilities: capabilities }))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
beforeEach(() => { vi.clearAllMocks(); invoke.mockResolvedValue(undefined) })
test("production and single-backend builds never display the switch", () => {
  capabilities.mockReturnValue({ backend: "cef", embeddedBrowser: true, canSwitchBackend: false })
  expect(render(<RuntimeRow />).container).toBeEmptyDOMElement()
})
test("development selection requires an explicit restart", async () => {
  capabilities.mockReturnValue({ backend: "cef", embeddedBrowser: true, canSwitchBackend: true })
  render(<RuntimeRow />)
  expect(screen.getByRole("button", {name:"重启并应用"})).toBeDisabled()
  fireEvent.click(screen.getByRole("combobox"))
  const option = await screen.findByRole("option", {name:"Wry"})
  fireEvent.pointerDown(option, {pointerType:"mouse"})
  fireEvent.click(option, {detail:1})
  await waitFor(() => expect(screen.getByRole("button", {name:"重启并应用"})).not.toBeDisabled())
  expect(invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", {name:"重启并应用"}))
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("runtime_restart", { backend:"wry" }))
})
