import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { ExtensionSettingsControls } from "../extension-settings-controls"

afterEach(() => {
  cleanup()
  document.querySelectorAll("[data-control-fixture]").forEach((node) => node.remove())
})

function fixture() {
  const container = document.createElement("div")
  container.dataset.controlFixture = ""
  container.innerHTML =
    '<div class="setting-item"><div class="setting-item-name">Environment</div><div class="setting-item-control"><select><option value="qa">QA</option><option value="prod">Production</option></select></div></div><div class="setting-item"><div class="setting-item-name">Use HTTPS</div><div class="setting-item-control"><input type="checkbox"></div></div>'
  const select = container.querySelector("select")!
  const toggle = container.querySelector("input")!
  document.body.append(container)
  return { container, select, toggle }
}

test("host controls preserve extension change callbacks and programmatic updates", async () => {
  const { container, select, toggle } = fixture()
  const changed = vi.fn()
  select.onchange = changed
  toggle.onchange = changed
  const view = render(<ExtensionSettingsControls container={container} />)
  const ui = within(document.body)
  await act(() => {
    select.value = "prod"
    toggle.checked = true

    return Promise.resolve()
  })
  expect(ui.getByRole("combobox", { name: "Environment" })).toHaveTextContent("Production")
  expect(ui.getByRole("switch", { name: "Use HTTPS" })).toHaveAttribute("aria-checked", "true")
  fireEvent.click(ui.getByRole("switch", { name: "Use HTTPS" }))
  expect(toggle.checked).toBe(false)
  expect(changed).toHaveBeenCalledTimes(1)
  fireEvent.click(ui.getByRole("combobox", { name: "Environment" }))
  const option = await ui.findByRole("option", { name: "QA" })
  fireEvent.pointerDown(option, { pointerType: "mouse" })
  fireEvent.click(option)
  await waitFor(() => expect(select.value).toBe("qa"))
  expect(changed).toHaveBeenCalledTimes(2)
  await act(() => {
    select.disabled = true

    return Promise.resolve()
  })
  expect(ui.getByRole("combobox", { name: "Environment" })).toBeDisabled()
  view.unmount()
  expect(select.hidden).toBe(false)
  expect(select.style.display).toBe("")
  expect(Object.hasOwn(select, "value")).toBe(false)
  container.remove()
})

test("dynamic controls are mounted and removed without keeping stale portals", async () => {
  const { container, select } = fixture()
  const view = render(<ExtensionSettingsControls container={container} />)
  await act(() => {
    select.closest(".setting-item")!.remove()

    return Promise.resolve()
  })
  await waitFor(() => expect(within(document.body).queryByRole("combobox")).toBeNull())
  const next = document.createElement("select")
  next.setAttribute("aria-label", "Provider")
  next.innerHTML = '<option value="one">One</option>'
  await act(() => {
    container.append(next)

    return Promise.resolve()
  })
  expect(await within(document.body).findByRole("combobox", { name: "Provider" })).toHaveTextContent("One")
  view.unmount()
  container.remove()
})

test("does not wrap hidden form inputs belonging to existing host controls", () => {
  const container = document.createElement("div")
  container.innerHTML = '<input type="checkbox" aria-hidden="true"><select hidden><option>Hidden</option></select>'
  const view = render(<ExtensionSettingsControls container={container} />)
  expect(container.querySelector("[data-extension-control]")).toBeNull()
  view.unmount()
})
