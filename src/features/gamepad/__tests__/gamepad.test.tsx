import type { GamepadEvent, GamepadSnapshot } from "@alwith/module-gamepad"
import { gamepadResources } from "@alwith/module-gamepad/locales"
import { type GamepadHost, GamepadPanel, GamepadProvider } from "@alwith/module-gamepad/react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createInstance } from "i18next"
import { I18nextProvider } from "react-i18next"
import { afterEach, expect, test, vi } from "vitest"

const snapshot: GamepadSnapshot = {
  version: 1,
  generation: 1,
  sequence: 1,
  state: "stopped",
  devices: [],
  activeDevice: null,
  activeProfile: null,
  savedRevision: null,
  appliedRevision: null,
  error: null
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function mount(state: GamepadSnapshot): Promise<{ host: GamepadHost; emit: (event: GamepadEvent) => void }> {
  const i18n = createInstance()
  await i18n.init({ lng: "en", resources: { en: { gamepad: gamepadResources.en } } })
  const listeners = new Set<(event: GamepadEvent) => void>()
  const host: GamepadHost = {
    platform: "macos",
    request: vi.fn(async request => {
      if (request.type === "selectDevice") {
        state = { ...state, sequence: state.sequence + 1, activeDevice: request.id }
        for (const listener of listeners) listener({ type: "snapshot", snapshot: state })
      }
      if (request.type === "loadProfile")
        return {
          type: "profile" as const,
          profile: {
            id: request.id,
            revision: 1,
            config: {
              deadzone: 0.2,
              poll_interval_ms: 8,
              mouse_move_scale: 1,
              buttons: {},
              left_stick: {},
              right_stick: {}
            },
            color: null
          }
        }
      return { type: "snapshot" as const, snapshot: state }
    }),
    listen: async handler => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    permissions: {
      status: async () => ({ authorized: false, mayPrompt: true, known: null }),
      request: async () => ({ authorized: false, mayPrompt: true, known: null }),
      openSettings: async () => {}
    },
    capture: { start: async () => {}, stop: async () => {}, listen: async () => () => {} },
    openBluetoothSettings: async () => {},
    onError: vi.fn()
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>'))
  )
  render(
    <I18nextProvider i18n={i18n}>
      <GamepadProvider host={host}>
        <GamepadPanel />
      </GamepadProvider>
    </I18nextProvider>
  )
  await waitFor(() => expect(host.request).toHaveBeenCalledWith({ type: "snapshot" }))
  return {
    host,
    emit: event => {
      for (const listener of listeners) listener(event)
    }
  }
}

test("the installed package hydrates service errors and does not start without permission", async () => {
  const { host } = await mount({ ...snapshot, state: "failed", error: "Native engine unavailable" })
  expect(await screen.findByText("Native engine unavailable")).toBeTruthy()
  expect(host.request).not.toHaveBeenCalledWith({ type: "start" })
  expect(screen.queryByText(gamepadResources.en.aiConfig.title)).toBeNull()
})

test("same-name controllers remain individually selectable and input follows instance identity", async () => {
  const device = {
    name: "Same controller",
    brand: "Generic",
    model: "generic",
    battery: null,
    charging: false,
    connection: "unknown" as const
  }
  const { emit } = await mount({
    ...snapshot,
    devices: [
      { ...device, id: 1 },
      { ...device, id: 2 }
    ]
  })
  const buttons = await screen.findAllByRole("button", { name: /Same controller/ })
  expect(buttons).toHaveLength(2)
  fireEvent.click(buttons[1])
  const input = (deviceId: number): GamepadEvent => ({
    type: "input",
    event: { kind: "input", device_id: deviceId, control: { Button: "south" }, pressed: true }
  })
  act(() => emit(input(1)))
  expect(screen.queryByText("south")).toBeNull()
  act(() => emit(input(2)))
  await waitFor(() => expect(screen.getByText("south")).toBeTruthy())
})
