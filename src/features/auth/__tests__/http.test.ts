import { describe, expect, test } from "bun:test"
import { createTokenStorage } from "@alwith/module-auth"
import { createAuthTransport } from "../http"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
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
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async (key, value) => {
      values.set(key, value)
    },
    delete: async key => {
      values.delete(key)
    }
  })
  await storage.tokenStorage.save("old-access", "old-refresh")
  let expirations = 0
  const transport = createAuthTransport({
    baseUrl: "https://api.example.test/service",
    storage,
    fetch: ((url, init) => fetcher(String(url), init ?? {})) as typeof fetch,
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
      async () => Response.json({ detail: "验证码错误或已过期。", status: 400 }, { status: 400 }),
      async () => {
        throw new Error("must not refresh")
      }
    )
    const error = await transport.request("/api/v1/auth/login", "POST", {}, false).catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: "验证码错误或已过期。" })
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
        async () => new Response(body, { status: 400 }),
        async () => fresh
      )
      const error = await transport.request("/api/v1/auth/login", "POST", {}, false).catch(error => error)
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
        async () => response,
        async () => {
          throw new Error("must not refresh")
        }
      )
      await expect(
        transport.request("/api/v1/auth/send-code", "POST", { email: "user@example.test", purpose: "LOGIN" }, false)
      ).resolves.toBeUndefined()
    }
  })
  test("nonempty malformed success responses still fail JSON parsing", async () => {
    const { transport } = await setup(
      async () => new Response("<html>upstream error</html>", { status: 200 }),
      async () => fresh
    )
    await expect(transport.request("/api/v1/auth/send-code", "POST", {}, false)).rejects.toBeInstanceOf(SyntaxError)
  })
  test("public login never sends saved credentials or refreshes on rejection", async () => {
    const { transport } = await setup(
      async (_url, init) => {
        expect(new Headers(init.headers).has("Authorization")).toBe(false)
        return new Response(null, { status: 401 })
      },
      async () => {
        throw new Error("must not refresh")
      }
    )
    await expect(transport.request("/api/v1/auth/login", "POST", {}, false)).rejects.toThrow("401")
  })
  test("concurrent expired requests share one refresh and retry with the new access token", async () => {
    let calls = 0
    const released = deferred<void>()
    const started = deferred<void>()
    const { transport, storage } = await setup(
      async (_url, init) =>
        new Headers(init.headers).get("Authorization") === "Bearer old-access"
          ? new Response(null, { status: 401 })
          : Response.json({ ok: true }),
      async token => {
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
      async () => new Response(null, { status: 401 }),
      async () => {
        throw { kind: "unauthorized", status: 401 }
      }
    )
    await expect(transport.request("/api/v1/me/profile", "GET")).rejects.toEqual({ kind: "unauthorized", status: 401 })
    expect(expirations()).toBe(1)
    expect(await storage.tokenStorage.getAccess()).toBe("")
  })
  test("temporary refresh failures preserve login", async () => {
    for (const kind of ["network", "timeout", "server", "parse"]) {
      const { transport, storage, expirations } = await setup(
        async () => new Response(null, { status: 401 }),
        async () => {
          throw { kind }
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
      async () => new Response(null, { status: 401 }),
      async () => {
        started.resolve()
        return result.promise
      }
    )
    const request = transport.request("/api/v1/me/profile", "GET").catch(error => error)
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
      async () => {
        throw new Error("must not fetch")
      },
      async () => fresh
    )
    await expect(transport.request("https://other.test", "GET")).rejects.toThrow("Invalid ALwith API path")
  })
})
