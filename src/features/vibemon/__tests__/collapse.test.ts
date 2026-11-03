import { expect, test, vi } from "vitest"

import { collapseToVibemon, type VibemonCollapseHost } from "../collapse"

function fixture(overrides: Partial<VibemonCollapseHost> = {}) {
  const calls: string[] = []
  const step = (name: string) =>
    vi.fn(() => {
      return Promise.try(() => {
        calls.push(name)
      })
    })
  const host: VibemonCollapseHost = {
    validate: vi.fn(),
    equippedVibemon: vi.fn(() => Promise.resolve("vibemon")),
    hasVibemon: vi.fn(() => Promise.resolve(true)),
    showVibemon: step("show"),
    bindSession: step("bind"),
    hideChat: step("hide"),
    restoreChat: step("restore"),
    ...overrides
  }
  return { host, calls }
}

test("collapse only hides chat after the vibemon, binding and bubble are ready", async () => {
  const { host, calls } = fixture()
  expect(await collapseToVibemon(host)).toEqual({ type: "shown" })
  expect(calls).toEqual(["show", "bind", "hide"])
  expect(host.hasVibemon).not.toHaveBeenCalled()
})

test.each([true, false])(
  "an unequipped account with vibemon=%s receives guidance without hiding or binding",
  async (hasVibemon) => {
    const { host, calls } = fixture({
      equippedVibemon: () => Promise.resolve(""),
      hasVibemon: () => Promise.resolve(hasVibemon)
    })
    expect(await collapseToVibemon(host)).toEqual({ type: "setup", view: hasVibemon ? "equip" : "pull" })
    expect(calls).toEqual([])
  }
)

test("inventory errors remain errors and do not become an empty collection", async () => {
  const { host, calls } = fixture({
    equippedVibemon: () => Promise.resolve(""),
    hasVibemon: () => {
      return Promise.try(() => {
        throw new Error("network")
      })
    }
  })
  await expect(collapseToVibemon(host)).rejects.toThrow("network")
  expect(calls).toEqual([])
})

test.each(["showVibemon", "bindSession"] as const)("a %s failure keeps chat visible", async (key) => {
  const { host } = fixture({
    [key]: () => {
      return Promise.try(() => {
        throw new Error("presentation failed")
      })
    }
  })
  await expect(collapseToVibemon(host)).rejects.toThrow("presentation failed")
  expect(host.hideChat).not.toHaveBeenCalled()
})

test("a partial hide failure restores the existing chat", async () => {
  const { host } = fixture({
    hideChat: () => {
      return Promise.try(() => {
        throw new Error("surface sync")
      })
    }
  })
  await expect(collapseToVibemon(host)).rejects.toThrow("surface sync")
  expect(host.restoreChat).toHaveBeenCalledOnce()
})

test("a session/account change while preparing the vibemon cannot hide or rebind another chat", async () => {
  let current = true
  const { host } = fixture({
    showVibemon: () => {
      current = false
      return Promise.resolve()
    },
    validate: () => {
      if (!current) throw new Error("stale request")
    }
  })
  await expect(collapseToVibemon(host)).rejects.toThrow("stale request")
  expect(host.bindSession).not.toHaveBeenCalled()
  expect(host.hideChat).not.toHaveBeenCalled()
})
