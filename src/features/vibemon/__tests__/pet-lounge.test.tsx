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
  const host = {
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
  return { ...view, send, open, getMyVibemons, ensureResource }
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
