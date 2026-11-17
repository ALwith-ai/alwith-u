import { afterEach, expect, test, vi } from "vitest"

import nativePermissions from "../../../../src-tauri/capabilities/default.json"
import { createPluginMarketplace, PluginAccountChangedError } from "../marketplace"

const auth = { backendOrigin: "https://chatgpt.com", accountId: "account", accessToken: "private-test-token" }
const page = (next: string | null = "next") => ({
  plugins: [
    {
      id: "remote-id",
      name: "example",
      installation_policy: "AVAILABLE",
      authentication_policy: "ON_USE",
      status: "ENABLED",
      release: { version: "1", display_name: "Example", description: "Description", keywords: ["test"] }
    }
  ],
  pagination: { next_page_token: next }
})
function setup() {
  const readAuth = vi.fn(async (_refresh: boolean) => auth)
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json(page()))
  return { readAuth, fetch, api: createPluginMarketplace({ readAuth, fetch }) }
}
afterEach(() => vi.restoreAllMocks())

test("U requests one bounded HTTP page and sends opaque continuation cursors unchanged", async () => {
  const { api, fetch } = setup()
  const first = await api.catalogPlugins()
  expect(first).toMatchObject({
    nextCursor: "next",
    data: [{ plugin: { remotePluginId: "remote-id", availability: "AVAILABLE" } }]
  })
  const [input, init] = fetch.mock.calls[0]!
  const url = new URL(String(input))
  expect(url.pathname).toBe("/backend-api/ps/plugins/list")
  expect(Object.fromEntries(url.searchParams)).toEqual({ scope: "GLOBAL", limit: "50" })
  expect(init).toMatchObject({
    method: "GET",
    redirect: "error",
    headers: { Authorization: "Bearer private-test-token", "ChatGPT-Account-ID": "account" }
  })
  await api.catalogPlugins({ cursor: "opaque+/=" })
  expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get("pageToken")).toBe("opaque+/=")
  expect(fetch).toHaveBeenCalledTimes(2)
})

test("search uses the HTTP search endpoint with its query and server cursor", async () => {
  const { api, fetch } = setup()
  await api.searchPlugins({ searchTerm: "PDF notes", cursor: "search-next", limit: 25 })
  const url = new URL(String(fetch.mock.calls[0]![0]))
  expect(url.pathname).toBe("/backend-api/ps/plugins/search")
  expect(Object.fromEntries(url.searchParams)).toEqual({
    scope: "GLOBAL",
    limit: "25",
    pageToken: "search-next",
    q: "PDF notes"
  })
})

test("non-ChatGPT accounts keep local catalogs usable without remote requests", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const api = createPluginMarketplace({ readAuth: async () => null, fetch })
  expect(await api.identity()).toBeNull()
  expect(await api.catalogPlugins()).toEqual({ data: [], nextCursor: null })
  expect(fetch).not.toHaveBeenCalled()
})

test("401 refreshes existing credentials once; terminal errors never expose response bodies", async () => {
  const { api, fetch, readAuth } = setup()
  fetch
    .mockReset()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json(page(null)))
  expect(await api.catalogPlugins()).toMatchObject({ nextCursor: null })
  expect(readAuth.mock.calls).toEqual([[false], [true]])
  fetch.mockResolvedValue(new Response("private-test-token", { status: 403 }))
  await expect(api.catalogPlugins()).rejects.toThrow("HTTP 403")
  expect(readAuth).toHaveBeenCalledTimes(3)
})

test.each([0, 51, -1, 1.5])("invalid page limit %s is rejected before authentication", async (limit) => {
  const { api, readAuth } = setup()
  await expect(api.catalogPlugins({ limit })).rejects.toThrow("page limit")
  expect(readAuth).not.toHaveBeenCalled()
})

test("malformed pages and service responses exceeding the requested limit fail explicitly", async () => {
  const { api, fetch } = setup()
  fetch.mockResolvedValueOnce(Response.json({ plugins: [{}], pagination: { next_page_token: null } }))
  await expect(api.catalogPlugins()).rejects.toThrow("invalid page")
  fetch.mockResolvedValueOnce(Response.json({ ...page(), plugins: [page().plugins[0], page().plugins[0]] }))
  await expect(api.catalogPlugins({ limit: 1 })).rejects.toThrow("exceeded")
})

test.each([
  "http://chatgpt.com",
  "https://attacker.test",
  "https://chatgpt.com.attacker.test",
  "https://user@chatgpt.com",
  "https://chatgpt.com:8443"
])("credentials are never sent to unsupported origin %s", async (backendOrigin) => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  const api = createPluginMarketplace({ readAuth: async () => ({ ...auth, backendOrigin }), fetch })
  await expect(api.catalogPlugins()).rejects.toThrow("origin")
  expect(fetch).not.toHaveBeenCalled()
})

test("account changes do not attach an old cursor to a new account or retry with its credentials", async () => {
  const { api, fetch, readAuth } = setup()
  await expect(api.catalogPlugins({ accountId: "old-account", cursor: "old-cursor" })).rejects.toBeInstanceOf(
    PluginAccountChangedError
  )
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
  readAuth.mockResolvedValueOnce(auth).mockResolvedValueOnce({ ...auth, accountId: "other" })
  await expect(api.catalogPlugins()).rejects.toBeInstanceOf(PluginAccountChangedError)
  expect(fetch).toHaveBeenCalledTimes(1)
})

test("cancellation reaches HTTP and prevents parsing a cancelled result", async () => {
  const { api, fetch } = setup()
  const controller = new AbortController()
  fetch.mockImplementation(async (_url, init) => {
    expect(init?.signal?.aborted).toBe(false)
    controller.abort()
    return Response.json(page())
  })
  await expect(api.catalogPlugins({ signal: controller.signal })).rejects.toThrow()
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
})

test("native HTTP permissions cover list and search on both host forms without a blanket ChatGPT grant", () => {
  const urls = nativePermissions.permissions.flatMap((entry) =>
    typeof entry === "object" && entry.identifier === "http:default" && "allow" in entry
      ? entry.allow.flatMap((rule) => ("url" in rule && rule.url.includes("chatgpt.com") ? [rule.url] : []))
      : []
  )
  expect(urls.toSorted()).toEqual(
    ["chatgpt.com", "*.chatgpt.com"]
      .flatMap((host) => ["list", "search"].map((path) => `https://${host}/backend-api/ps/plugins/${path}`))
      .toSorted()
  )
})
