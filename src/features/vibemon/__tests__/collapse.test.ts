import { expect, test, vi } from "vitest"

import { collapseToPet, type PetCollapseHost } from "../collapse"

function fixture(overrides: Partial<PetCollapseHost> = {}) {
  const calls: string[] = []
  const step = (name: string) =>
    vi.fn(() => {
      return Promise.try(() => {
        calls.push(name)
      })
    })
  const host: PetCollapseHost = {
    validate: vi.fn(),
    equippedPet: vi.fn(() => Promise.resolve("pet")),
    hasPets: vi.fn(() => Promise.resolve(true)),
    showPet: step("show"),
    bindSession: step("bind"),
    openBubble: step("bubble"),
    hideChat: step("hide"),
    restoreChat: step("restore"),
    ...overrides
  }
  return { host, calls }
}

test("collapse only hides chat after the pet, binding and bubble are ready", async () => {
  const { host, calls } = fixture()
  expect(await collapseToPet(host)).toEqual({ type: "shown" })
  expect(calls).toEqual(["show", "bind", "bubble", "hide"])
  expect(host.hasPets).not.toHaveBeenCalled()
})

test.each([true, false])(
  "an unequipped account with pets=%s receives guidance without hiding or binding",
  async (hasPets) => {
    const { host, calls } = fixture({ equippedPet: () => Promise.resolve(""), hasPets: () => Promise.resolve(hasPets) })
    expect(await collapseToPet(host)).toEqual({ type: "setup", view: hasPets ? "equip" : "pull" })
    expect(calls).toEqual([])
  }
)

test("inventory errors remain errors and do not become an empty collection", async () => {
  const { host, calls } = fixture({
    equippedPet: () => Promise.resolve(""),
    hasPets: () => {
      return Promise.try(() => {
        throw new Error("network")
      })
    }
  })
  await expect(collapseToPet(host)).rejects.toThrow("network")
  expect(calls).toEqual([])
})

test.each(["showPet", "bindSession", "openBubble"] as const)("a %s failure keeps chat visible", async (key) => {
  const { host } = fixture({
    [key]: () => {
      return Promise.try(() => {
        throw new Error("presentation failed")
      })
    }
  })
  await expect(collapseToPet(host)).rejects.toThrow("presentation failed")
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
  await expect(collapseToPet(host)).rejects.toThrow("surface sync")
  expect(host.restoreChat).toHaveBeenCalledOnce()
})

test("a session/account change while preparing the pet cannot hide or rebind another chat", async () => {
  let current = true
  const { host } = fixture({
    showPet: () => {
      current = false
      return Promise.resolve()
    },
    validate: () => {
      if (!current) throw new Error("stale request")
    }
  })
  await expect(collapseToPet(host)).rejects.toThrow("stale request")
  expect(host.bindSession).not.toHaveBeenCalled()
  expect(host.hideChat).not.toHaveBeenCalled()
})
