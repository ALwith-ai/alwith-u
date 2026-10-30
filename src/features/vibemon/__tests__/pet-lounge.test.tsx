import { configureVibemon, initializeSettings, type VibemonHost } from "@alwith/module-auth/pets/core"
import { PetLounge } from "@alwith/module-auth/pets/react"
import { cleanup, fireEvent, render } from "@testing-library/react"
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

async function setup(pet: string, owned = true) {
  const getMyVibemons = vi.fn(() => Promise.resolve(owned ? [{ vibemon_uuid: pet }] : []))
  const ensureResource = vi.fn()
  const sound = vi.fn(async () => {})
  const host = {
    windows: { call: sound },
    account: () => ({ apiHost: "test", userId: "user", revision: 1 }),
    storage: {
      get: (key: string) =>
        Promise.resolve(
          key === "vibemon.accounts" ? { "test/user": { pet, enabled: false, position: null } } : undefined
        )
    },
    subscribeStorage: () => () => {},
    assets: {
      getMyVibemons,
      ensureResource,
      resources: { cached: () => Promise.resolve({ name: "pet", sheet: null }), preview: () => Promise.resolve(null) }
    },
    onError: vi.fn()
  } as unknown as VibemonHost
  disposeHost = configureVibemon(host)
  disposeSettings = await initializeSettings()
  const send = vi.fn(async () => {})
  const open = vi.fn()
  const view = render(
    <div>
      <PetLounge active nest={{ size: 100, bottom: 24, inlineEnd: 71 }} onOpenCenter={open} onSend={send} />
    </div>
  )
  return { ...view, send, open, getMyVibemons, ensureResource, sound }
}

test("the empty nest opens the pet center without requesting inventory or downloading", async () => {
  const view = await setup("")
  fireEvent.click(view.getByRole("button", { name: "Vibémon" }))
  expect(view.open).toHaveBeenCalledOnce()
  expect(view.getMyVibemons).not.toHaveBeenCalled()
  expect(view.ensureResource).not.toHaveBeenCalled()
})

test("clicking a cached lounge pet does not open the desktop or the pet center", async () => {
  const view = await setup("pet")
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
  const view = await setup("pet", false)
  expect(await view.findByRole("alert")).toHaveTextContent("does not own")
  expect(view.queryByRole("button", { name: "Vibémon" })).toBeNull()
  expect(view.ensureResource).not.toHaveBeenCalled()
})

test("dragging out grows the pet, plays the burst sound once and hands off at the release center", async () => {
  const view = await setup("pet")
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
  expect(view.getByTestId("pet-lounge-drop")).toBeInTheDocument()
  fireEvent.pointerUp(button, { pointerId: 1, clientX: 300, clientY: 550 })
  expect(view.send).toHaveBeenCalledExactlyOnceWith("pet", { x: 300, y: 550 })
  expect(view.sound).toHaveBeenCalledExactlyOnceWith("sound")
  expect(view.getByTestId("pet-lounge-burst")).toBeInTheDocument()
})

test("releasing a short drag returns to the nest without opening a desktop pet or playing a sound", async () => {
  const view = await setup("pet")
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
  expect(view.getByTestId("pet-lounge-drop")).toBeInTheDocument()
})
