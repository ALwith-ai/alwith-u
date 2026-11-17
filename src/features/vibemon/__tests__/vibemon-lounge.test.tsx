import { configureVibemon, initializeSettings, type VibemonHost } from "@alwith/module-auth/vibemon/core"
import { VibemonLounge } from "@alwith/module-auth/vibemon/react"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

await initI18n("en")
let disposeHost: (() => void) | undefined
let disposeSettings: (() => void) | undefined
afterEach(() => {
  cleanup()
  disposeSettings?.()
  disposeHost?.()
  vi.restoreAllMocks()
})

async function setup(vibemon: string, owned = true) {
  const getMyVibemons = vi.fn(() => Promise.resolve(owned ? [{ vibemon_uuid: vibemon }] : []))
  const ensureResource = vi.fn()
  const sound = vi.fn(async () => {})
  const host = {
    windows: { call: sound },
    account: () => ({ apiHost: "test", userId: "user", revision: 1 }),
    storage: {
      get: (key: string) =>
        Promise.resolve(
          key === "vibemon.accounts" ? { "test/user": { vibemon, enabled: false, position: null } } : undefined
        )
    },
    subscribeStorage: () => () => {},
    assets: {
      getMyVibemons,
      ensureResource,
      resources: {
        cached: () => Promise.resolve({ name: "vibemon", sheet: null }),
        preview: () => Promise.resolve(null)
      }
    },
    onError: vi.fn()
  } as unknown as VibemonHost
  disposeHost = configureVibemon(host)
  disposeSettings = await initializeSettings()
  const send = vi.fn(async () => {})
  const open = vi.fn()
  const view = render(
    <div>
      <VibemonLounge active nest={{ size: 100, bottom: 24, inlineEnd: 71 }} onOpenCenter={open} onSend={send} />
    </div>
  )
  return { ...view, send, open, getMyVibemons, ensureResource, sound }
}

test("the empty nest opens the vibemon center without requesting inventory or downloading", async () => {
  const view = await setup("")
  fireEvent.click(view.getByRole("button", { name: "Vibémon" }))
  expect(view.open).toHaveBeenCalledOnce()
  expect(view.getMyVibemons).not.toHaveBeenCalled()
  expect(view.ensureResource).not.toHaveBeenCalled()
})

test("clicking a cached lounge vibemon does not open the desktop or the vibemon center", async () => {
  const view = await setup("vibemon")
  const button = await view.findByRole("button", { name: "Vibémon" })
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn()
  button.hasPointerCapture = vi.fn(() => true)
  fireEvent.click(button)
  fireEvent.click(button)
  fireEvent.keyDown(button, { key: "Enter" })
  expect(view.send).not.toHaveBeenCalled()
  expect(view.open).not.toHaveBeenCalled()
  expect(view.ensureResource).not.toHaveBeenCalled()
  expect(button).toBeEnabled()
  expect(view.queryByRole("dialog")).toBeNull()
})

test("an unowned selection cannot be sent to the desktop", async () => {
  const view = await setup("vibemon", false)
  expect(await view.findByRole("alert")).toHaveTextContent("does not own")
  expect(view.queryByRole("button", { name: "Vibémon" })).toBeNull()
  expect(view.ensureResource).not.toHaveBeenCalled()
})

test("dragging out grows the vibemon, plays the burst sound once and hands off at the release center", async () => {
  const view = await setup("vibemon")
  const button = await view.findByRole("button", { name: "Vibémon" })
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn()
  button.hasPointerCapture = vi.fn(() => true)
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 500, 100, 100))
  const parent = button.parentElement
  if (!parent) throw new Error("Missing lounge")
  vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(new DOMRect(450, 0, 300, 700))
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 550, clientY: 550 })
  fireEvent.pointerMove(button, { pointerId: 1, clientX: 300, clientY: 550 })
  expect(view.getByTestId("vibemon-lounge-drop")).toBeInTheDocument()
  fireEvent.pointerUp(button, { pointerId: 1, clientX: 300, clientY: 550 })
  expect(view.send).toHaveBeenCalledExactlyOnceWith("vibemon", { x: 300, y: 550 })
  expect(view.sound).toHaveBeenCalledExactlyOnceWith("sound")
  expect(view.getByTestId("vibemon-lounge-burst")).toBeInTheDocument()
})

test("releasing a short drag returns to the nest without opening a desktop vibemon or playing a sound", async () => {
  const view = await setup("vibemon")
  const button = await view.findByRole("button", { name: "Vibémon" })
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn()
  button.hasPointerCapture = vi.fn(() => true)
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 500, 100, 100))
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 550, clientY: 550 })
  fireEvent.pointerMove(button, { pointerId: 1, clientX: 570, clientY: 540 })
  fireEvent.pointerUp(button, { pointerId: 1, clientX: 570, clientY: 540 })
  expect(view.send).not.toHaveBeenCalled()
  expect(view.sound).not.toHaveBeenCalled()
  expect(button).toHaveStyle({ opacity: "0" })
  expect(view.queryByTestId("vibemon-lounge-drop")).not.toBeInTheDocument()
  expect(view.getByTestId("vibemon-lounge-preview").style.transition).toContain(
    "left 200ms ease-out, top 200ms ease-out, transform 200ms ease-out"
  )
})

test.each(["release", "capture loss", "cancel", "blur"])(
  "a lounge drag settles after %s outside the original button",
  async (ending) => {
    const view = await setup("vibemon")
    const button = await view.findByRole("button", { name: "Vibémon" })
    button.setPointerCapture = vi.fn()
    button.releasePointerCapture = vi.fn()
    button.hasPointerCapture = vi.fn(() => true)
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 500, 100, 100))
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 550, clientY: 550 })
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 570, clientY: 540 })
    expect(view.getByTestId("vibemon-lounge-preview")).toHaveAttribute("inert")
    if (ending === "release") {
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 570, clientY: 540 })
      expect(button).toHaveStyle({ opacity: "0" })
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 570, clientY: 540 })
    } else if (ending === "capture loss") fireEvent.lostPointerCapture(button, { pointerId: 1 })
    else if (ending === "cancel") fireEvent.pointerCancel(window, { pointerId: 1 })
    else fireEvent.blur(window)
    await waitFor(() => expect(button).toHaveStyle({ opacity: "1" }))
    expect(view.queryByTestId("vibemon-lounge-preview")).not.toBeInTheDocument()
    expect(view.queryByTestId("vibemon-lounge-drop")).not.toBeInTheDocument()
    expect(view.send).not.toHaveBeenCalled()
    expect(view.sound).not.toHaveBeenCalled()
  }
)

test("releasing capture during desktop handoff keeps the send preview until the handoff finishes", async () => {
  const view = await setup("vibemon")
  let finish!: () => void
  view.send.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
  const button = await view.findByRole("button", { name: "Vibémon" })
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn(() => fireEvent.lostPointerCapture(button, { pointerId: 1 }))
  button.hasPointerCapture = vi.fn(() => true)
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 500, 100, 100))
  const parent = button.parentElement!
  vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(new DOMRect(450, 0, 300, 700))
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 550, clientY: 550 })
  fireEvent.pointerMove(button, { pointerId: 1, clientX: 300, clientY: 550 })
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 550 })
  expect(view.send).toHaveBeenCalledOnce()
  expect(view.getByTestId("vibemon-lounge-preview")).toBeInTheDocument()
  await act(async () => finish())
  expect(view.queryByTestId("vibemon-lounge-preview")).not.toBeInTheDocument()
})

test.each([
  { direction: "ltr", start: 550, end: 351, y: 550, sends: false },
  { direction: "ltr", start: 550, end: 350, y: 550, sends: true },
  { direction: "ltr", start: 550, end: 550, y: 300, sends: false },
  { direction: "rtl", start: 650, end: 849, y: 550, sends: false },
  { direction: "rtl", start: 650, end: 850, y: 550, sends: true }
])("Desktop release boundary: $direction ($end, $y), sends=$sends", async ({ direction, start, end, y, sends }) => {
  const view = await setup("vibemon")
  const button = await view.findByRole("button", { name: "Vibémon" })
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn()
  button.hasPointerCapture = vi.fn(() => true)
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(start - 50, 500, 100, 100))
  const parent = button.parentElement
  if (!parent) throw new Error("Missing lounge")
  parent.style.direction = direction
  vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(new DOMRect(450, 0, 300, 800))
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: start, clientY: 550 })
  fireEvent.pointerMove(button, { pointerId: 1, clientX: end, clientY: y })
  expect(view.send).not.toHaveBeenCalled()
  fireEvent.pointerUp(button, { pointerId: 1, clientX: end, clientY: y })
  if (sends) expect(view.send).toHaveBeenCalledExactlyOnceWith("vibemon", { x: end, y })
  else expect(view.send).not.toHaveBeenCalled()
})

test("Desktop hands off only after more than half of the scaled ghost leaves the viewport", async () => {
  const view = await setup("vibemon")
  const button = await view.findByRole("button", { name: "Vibémon" })
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn()
  button.hasPointerCapture = vi.fn(() => true)
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 500, 100, 100))
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 550, clientY: 550 })
  fireEvent.pointerMove(button, { pointerId: 1, clientX: 0, clientY: 550 })
  expect(view.send).not.toHaveBeenCalled()
  fireEvent.pointerMove(button, { pointerId: 1, clientX: -1, clientY: 550 })
  expect(view.send).toHaveBeenCalledExactlyOnceWith("vibemon", { x: -1, y: 550 })
})

test("Desktop uses the last drag sample for release and removes the nest frame during rebound", async () => {
  const view = await setup("vibemon")
  const button = await view.findByRole("button", { name: "Vibémon" })
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn()
  button.hasPointerCapture = vi.fn(() => true)
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 500, 100, 100))
  fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 550, clientY: 550 })
  fireEvent.pointerMove(button, { pointerId: 1, clientX: 554, clientY: 550 })
  expect(view.queryByTestId("vibemon-lounge-drop")).not.toBeInTheDocument()
  fireEvent.pointerMove(button, { pointerId: 1, clientX: 570, clientY: 550 })
  expect(view.getByTestId("vibemon-lounge-drop")).toBeInTheDocument()
  fireEvent.pointerUp(button, { pointerId: 1, clientX: 300, clientY: 550 })
  expect(view.send).not.toHaveBeenCalled()
  expect(view.queryByTestId("vibemon-lounge-drop")).not.toBeInTheDocument()
  expect(view.getByTestId("vibemon-lounge-preview").style.transform).toBe("scale(1)")
})
