import { expect, test } from "bun:test"

import { createBrowserTools, handleMessage, tools } from "../../browser-mcp.mjs"

test("MCP exposes browser tools and reports tool errors without corrupting the protocol", async () => {
  const run = async () => {
    throw new Error("guest closed")
  }
  const list = await handleMessage({ id: 1, method: "tools/list" }, run)
  expect(list.result.tools).toEqual(tools)
  const reply = await handleMessage({ id: 2, method: "tools/call", params: { name: "browser_list" } }, run)
  expect(reply.result.isError).toBe(true)
  expect(reply.result.content[0].text).toContain("guest closed")
  expect(await handleMessage({ method: "notifications/initialized" }, run)).toBeNull()
})

test("invalid targets and navigation are rejected before connecting", async () => {
  let attached = false
  const run = createBrowserTools(
    async () => ({}),
    async () => {
      attached = true
      throw Error("unexpected")
    }
  )
  await expect(run("browser_click", { selector: "button" })).rejects.toThrow("explicit guest")
  await expect(run("browser_navigate", { target: "guest", url: "file:///etc/passwd" })).rejects.toThrow("HTTP(S)")
  await expect(run("browser_evaluate", { target: "guest", expression: "" })).rejects.toThrow("expression")
  await expect(run("browser_wait", { target: "guest", selector: "button", state: "invalid" })).rejects.toThrow(
    "wait state"
  )
  expect(attached).toBe(false)
})

test("attachment failures remain retryable and disposal prevents new work", async () => {
  let attempts = 0
  const run = createBrowserTools(
    async () => ({}),
    async () => {
      attempts++
      throw Error("guest closed")
    }
  )
  await expect(run("browser_read_page", { target: "guest" })).rejects.toThrow("guest closed")
  await expect(run("browser_read_page", { target: "guest" })).rejects.toThrow("guest closed")
  expect(attempts).toBe(2)
  await run.close()
  await expect(run("browser_read_page", { target: "guest" })).rejects.toThrow("tools are closed")
  await expect(run("browser_list")).rejects.toThrow("tools are closed")
})

test("opening a website needs no existing tab or project", async () => {
  const requests: unknown[] = []
  const run = createBrowserTools(async (request) => {
    requests.push(request)
    return { target: "browser-new" }
  })
  expect(await run("browser_open", { url: "https://example.com" })).toEqual({ target: "browser-new" })
  expect(requests).toEqual([{ method: "open", params: { url: "https://example.com/" } }])
  await expect(run("browser_open", { url: "file:///tmp/test" })).rejects.toThrow("HTTP(S)")
})
