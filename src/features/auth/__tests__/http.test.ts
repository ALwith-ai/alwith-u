import { createTokenStorage } from "@alwith/module-auth"
import { describe, expect, test } from "vitest"

import { createAuthTransport } from "../http"

/** Native and transport layers reject with plain values; tests reproduce that exactly. */
const nonError = (value: unknown): unknown => value

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function setup(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  refresh: (token: string) => Promise<{ access_token: string; refresh_token: string }>
) {
  const values = new Map<string, unknown>()
  const storage = createTokenStorage({
    get: <T>(key: string) => Promise.try(() => values.get(key) as T | undefined),
    set: (key, value) => {
      return Promise.try(() => {
        values.set(key, value)
      })
    },
    delete: (key) => {
      return Promise.try(() => {
        values.delete(key)
      })
    }
  })
  await storage.tokenStorage.save("old-access", "old-refresh")
  let expirations = 0
  const transport = createAuthTransport({
    baseUrl: "https://api.example.test/service",
    storage,
    fetch: (url, init) => fetcher(url as string, init ?? {}),
    refresh,
    expired: async () => {
      expirations++
      await storage.clearAllAuth()
    }
  })
  return { storage, transport, expirations: () => expirations }
}
const fresh = { access_token: "new-access", refresh_token: "new-refresh" }
describe("ALwith account HTTP adapter", () => {
  test("login rejection exposes the API's error detail through Error.message", async () => {
    const { transport } = await setup(
      () => Promise.try(() => Response.json({ detail: "验证码错误或已过期。", status: 400 }, { status: 400 })),
      () => {
        return Promise.try(() => {
          throw new Error("must not refresh")
        })
      }
    )
    const error = await transport.request("/api/v1/auth/login", "POST", {}, false).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: "验证码错误或已过期。", status: 400 })
  })
  test("unstructured error bodies never become user-facing details", async () => {
    for (const body of [
      "",
      "<html>gateway error</html>",
      '{"detail":42}',
      '{"detail":"  "}',
      '{"access_token":"secret"}'
    ]) {
      const { transport } = await setup(
        () => Promise.try(() => new Response(body, { status: 400 })),
        () => Promise.resolve(fresh)
      )
      const error = await transport.request("/api/v1/auth/login", "POST", {}, false).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ message: "ALwith HTTP 400" })
    }
  })
  test("sending a verification code accepts empty 200 and 204 responses", async () => {
    for (const response of [
      new Response(null, { status: 200, headers: { "Content-Length": "0" } }),
      new Response(null, { status: 200 }),
      new Response(null, { status: 204 })
    ]) {
      const { transport } = await setup(
        () => Promise.resolve(response),
        () => {
          return Promise.try(() => {
            throw new Error("must not refresh")
          })
        }
      )
      await expect(
        transport.request("/api/v1/auth/send-code", "POST", { email: "user@example.test", purpose: "LOGIN" }, false)
      ).resolves.toBeUndefined()
    }
  })
  test("nonempty malformed success responses still fail JSON parsing", async () => {
    const { transport } = await setup(
      () => Promise.try(() => new Response("<html>upstream error</html>", { status: 200 })),
      () => Promise.resolve(fresh)
    )
    await expect(transport.request("/api/v1/auth/send-code", "POST", {}, false)).rejects.toBeInstanceOf(SyntaxError)
  })
  test("public login never sends saved credentials or refreshes on rejection", async () => {
    const { transport } = await setup(
      (_url, init) => {
        return Promise.try(() => {
          expect(new Headers(init.headers).has("Authorization")).toBe(false)
          return new Response(null, { status: 401 })
        })
      },
      () => {
        return Promise.try(() => {
          throw new Error("must not refresh")
        })
      }
    )
    await expect(transport.request("/api/v1/auth/login", "POST", {}, false)).rejects.toThrow("401")
  })
  test("concurrent expired requests share one refresh and retry with the new access token", async () => {
    let calls = 0
    const released = deferred<void>()
    const started = deferred<void>()
    const { transport, storage } = await setup(
      (_url, init) =>
        Promise.try(() =>
          new Headers(init.headers).get("Authorization") === "Bearer old-access"
            ? new Response(null, { status: 401 })
            : Response.json({ ok: true })
        ),
      async (token) => {
        calls++
        expect(token).toBe("old-refresh")
        started.resolve()
        await released.promise
        return fresh
      }
    )
    const first = transport.request("/api/v1/me/profile", "GET")
    const second = transport.request("/api/v1/me/profile", "GET")
    await started.promise
    released.resolve()
    expect(await first).toEqual({ ok: true })
    expect(await second).toEqual({ ok: true })
    expect(calls).toBe(1)
    expect(await storage.tokenStorage.getRefresh()).toBe("new-refresh")
  })
  test("refresh rejection expires only this app's credentials", async () => {
    const { transport, storage, expirations } = await setup(
      () => Promise.try(() => new Response(null, { status: 401 })),
      () => {
        return Promise.try(() => {
          throw nonError({ kind: "unauthorized", status: 401 })
        })
      }
    )
    await expect(transport.request("/api/v1/me/profile", "GET")).rejects.toEqual({ kind: "unauthorized", status: 401 })
    expect(expirations()).toBe(1)
    expect(await storage.tokenStorage.getAccess()).toBe("")
  })
  test("temporary refresh failures preserve login", async () => {
    for (const kind of ["network", "timeout", "server", "parse"]) {
      const { transport, storage, expirations } = await setup(
        () => Promise.try(() => new Response(null, { status: 401 })),
        () => {
          return Promise.try(() => {
            throw nonError({ kind })
          })
        }
      )
      await expect(transport.request("/api/v1/me/profile", "GET")).rejects.toEqual({ kind })
      expect(expirations()).toBe(0)
      expect(await storage.tokenStorage.getRefresh()).toBe("old-refresh")
    }
  })
  test("late refresh cannot restore credentials after logout begins", async () => {
    const result = deferred<typeof fresh>()
    const started = deferred<void>()
    const { transport, storage } = await setup(
      () => Promise.try(() => new Response(null, { status: 401 })),
      async () => {
        started.resolve()
        return result.promise
      }
    )
    const request = transport.request("/api/v1/me/profile", "GET").catch((error: unknown) => error)
    await started.promise
    const settled = transport.invalidate()
    result.resolve(fresh)
    await settled
    await storage.clearAllAuth()
    expect(await request).toBeInstanceOf(Error)
    expect(await storage.tokenStorage.getAccess()).toBe("")
  })
  test("requests outside the API namespace are rejected", async () => {
    const { transport } = await setup(
      () => {
        return Promise.try(() => {
          throw new Error("must not fetch")
        })
      },
      () => Promise.resolve(fresh)
    )
    await expect(transport.request("https://other.test", "GET")).rejects.toThrow("Invalid ALwith API path")
  })
})

test("native authenticated operations retry once with the refreshed account token", async () => {
  const { transport } = await setup(
    () => Promise.reject(new Error("HTTP must stay native")),
    () => Promise.resolve(fresh)
  )
  const tokens: string[] = []
  const result = await transport.authenticated(async (token: string) => {
    tokens.push(token)
    if (token === "old-access") throw { status: 401 }
    return { models: ["account-model"] }
  })
  expect(result).toEqual({ models: ["account-model"] })
  expect(tokens).toEqual(["old-access", "new-access"])
})
