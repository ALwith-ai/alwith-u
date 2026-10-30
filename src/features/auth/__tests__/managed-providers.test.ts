import { expect, test } from "vitest"

import { createAccountTransition, createManagedProviders } from "../managed-providers"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("same-account refreshes share one request and logout invalidates its result", async () => {
  const pending = deferred<void>()
  let requests = 0
  let cleared = false
  const controller = createManagedProviders({
    bind: async () => 1,
    refresh: async () => {
      requests++
      await pending.promise
    },
    clear: async () => {
      cleared = true
    }
  })
  const first = controller.refresh("account-a")
  const second = controller.refresh("account-a")
  await Promise.resolve()
  await controller.clear()
  pending.resolve()
  await expect(first).rejects.toThrow(/changed/i)
  await expect(second).rejects.toThrow(/changed/i)
  expect(requests).toBeLessThanOrEqual(1)
  expect(cleared).toBe(true)
})

test("refresh after account replacement never joins the previous account request", async () => {
  const pending = deferred<void>()
  const owners: string[] = []
  let generation = 0
  const controller = createManagedProviders({
    bind: async (owner: string) => {
      owners.push(owner)
      return ++generation
    },
    refresh: async (current: number) => {
      if (current === 1) await pending.promise
    },
    clear: async () => {}
  })
  const old = controller.refresh("account-a").catch((error: unknown) => error)
  await Promise.resolve()
  await controller.clear()
  await controller.refresh("account-b")
  pending.resolve()
  expect(await old).toBeInstanceOf(Error)
  expect(owners).toEqual(["account-a", "account-b"])
})

test("logout waits for an in-flight login and the next login runs after a failed transition", async () => {
  const transition = createAccountTransition()
  const saving = deferred<void>()
  let identity: string | null = null
  const writes: string[] = []
  const login = transition(async () => {
    await saving.promise
    identity = "a"
    writes.push("login-a")
  })
  const logout = transition(async () => {
    identity = null
    writes.push("logout")
    throw new Error("remote logout failed")
  })
  const failed = expect(logout).rejects.toThrow("remote logout failed")
  const next = transition(async () => {
    identity = "b"
    writes.push("login-b")
  })
  await Promise.resolve()
  expect(writes).toEqual([])
  saving.resolve()
  await Promise.all([login, failed, next])
  expect(writes).toEqual(["login-a", "logout", "login-b"])
  expect(identity).toBe("b")
})
