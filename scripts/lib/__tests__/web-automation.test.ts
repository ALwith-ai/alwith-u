import { expect, test } from "bun:test"

import type { Browser } from "playwright-core"

import { createBrowserTools } from "../../../src/features/web-automation/engine.mjs"

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
  await expect(
    run("browser_wait", {
      target: "guest",
      selector: "button",
      state: "invalid"
    })
  ).rejects.toThrow("wait state")
  await expect(
    run("browser_upload", {
      target: "guest",
      selector: "input",
      paths: ["relative.txt"]
    })
  ).rejects.toThrow("absolute paths")
  await expect(
    run("browser_check", {
      target: "guest",
      selector: "input",
      checked: "true"
    })
  ).rejects.toThrow("boolean")
  await expect(run("browser_scroll", { target: "guest", selector: "body", y: Infinity })).rejects.toThrow("finite")
  await expect(run("browser_read_page", { target: "guest", offset: -1 })).rejects.toThrow("offset")
  await expect(
    run("browser_read_elements", {
      target: "guest",
      selector: "tr",
      limit: 101
    })
  ).rejects.toThrow("limit")
  await expect(
    run("browser_type", {
      target: "guest",
      selector: "input",
      text: "x",
      frame: ""
    })
  ).rejects.toThrow("frame")
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
  expect(await run("browser_open", { url: "https://example.com" })).toEqual({
    target: "browser-new"
  })
  expect(requests).toEqual([{ method: "open", params: { url: "https://example.com/" } }])
  await expect(run("browser_open", { url: "file:///tmp/test" })).rejects.toThrow("HTTP(S)")
})

test("application executor scopes native calls by session and never reuses a changed credential", async () => {
  const { createExecutor } = await import("../../../src/features/web-automation/worker.mjs")
  const calls: string[] = []
  const executor = createExecutor(undefined, async (_url, init) => {
    calls.push(new Headers(init?.headers).get("Authorization")!)
    return Response.json({ targets: [] })
  })
  const request = {
    version: 1,
    kind: "call",
    endpoint: "http://127.0.0.1:12345",
    sessionId: "a",
    token: "token-a",
    transportToken: "host",
    name: "browser_list",
    args: {}
  }
  try {
    await executor.dispatch(request)
    await executor.dispatch({ ...request, sessionId: "b", token: "token-b" })
    expect(calls).toEqual(["Bearer token-a", "Bearer token-b"])
    await expect(executor.dispatch({ ...request, token: "changed" })).rejects.toThrow("binding changed")
    await expect(
      executor.dispatch({
        version: 1,
        kind: "release",
        sessionId: "a",
        token: "old",
        targets: []
      })
    ).rejects.toThrow("Stale")
    await executor.dispatch({
      version: 1,
      kind: "release",
      sessionId: "a",
      token: "token-a",
      targets: []
    })
    await executor.dispatch({ ...request, token: "renewed" })
    expect(calls.at(-1)).toBe("Bearer renewed")
  } finally {
    await executor.close()
  }
})

test("application executor does not retry an ambiguous write failure", async () => {
  const { createExecutor } = await import("../../../src/features/web-automation/worker.mjs")
  let calls = 0
  const executor = createExecutor(undefined, async () => {
    calls++
    throw Error("connection lost after delivery")
  })
  try {
    await expect(
      executor.dispatch({
        version: 1,
        kind: "call",
        endpoint: "http://127.0.0.1:12345",
        sessionId: "a",
        token: "token-a",
        name: "browser_open",
        args: { url: "https://example.com" }
      })
    ).rejects.toThrow("connection lost")
    expect(calls).toBe(1)
  } finally {
    await executor.close()
  }
})

test("releasing a page disconnects only its controller before relinquishing native ownership", async () => {
  const events: string[] = []
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    on() {},
    frames: () => [],
    mainFrame: () => ({ evaluate: async () => "fixture" }),
    url: () => "https://example.test"
  }
  const run = createBrowserTools(
    async ({ target, method }) => {
      events.push(`${method}:${target}`)
      return { released: true }
    },
    async (target) => {
      events.push(`attach:${target}`)
      return {
        contexts: () => [{ pages: () => [page] }],
        on() {},
        close: async () => {
          events.push(`detach:${target}`)
        }
      } as unknown as Browser
    }
  )
  try {
    for (const target of ["a", "b"]) await run("browser_evaluate", { target, expression: "document.title" })
    await run("browser_release", { target: "a" })
    expect(events).toEqual(["attach:a", "attach:b", "detach:a", "release:a"])
    await run("browser_evaluate", {
      target: "b",
      expression: "document.title"
    })
    expect(events.filter((event) => event === "attach:b")).toHaveLength(1)
    await run("browser_evaluate", {
      target: "a",
      expression: "document.title"
    })
    expect(events.at(-1)).toBe("attach:a")
  } finally {
    await run.close()
  }
})

test("application cache retains idle connections across conversations and invalidates observations", async () => {
  const { createExecutor } = await import("../../../src/features/web-automation/worker.mjs")
  const attached: string[] = []
  const detached: string[] = []
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    on() {},
    frames: () => [],
    mainFrame: () => ({ evaluate: async () => "preserved draft" }),
    url: () => "https://example.test"
  }
  const executor = createExecutor(
    async (url, options) => {
      attached.push(url)
      expect(options.headers?.Authorization).toBe("Bearer application")
      return {
        contexts: () => [{ pages: () => [page] }],
        on() {},
        close: async () => {
          detached.push(url)
        }
      } as unknown as Browser
    },
    async () => Response.json({ ok: true })
  )
  const request = {
    version: 1,
    kind: "call",
    endpoint: "http://127.0.0.1:12345",
    transportToken: "application",
    sessionId: "a",
    token: "a-turn",
    name: "browser_evaluate",
    args: { target: "tab", expression: "document.title" }
  }
  try {
    await executor.dispatch(request)
    await executor.dispatch({
      version: 1,
      kind: "release",
      sessionId: "a",
      token: "a-turn",
      targets: ["tab"]
    })
    const result = await executor.dispatch({
      ...request,
      sessionId: "b",
      token: "b-turn"
    })
    expect((result as { result: string }).result).toBe("preserved draft")
    expect(attached).toHaveLength(1)
    expect(detached).toHaveLength(0)
    await expect(executor.dispatch(request)).rejects.toThrow("revoked")
  } finally {
    await executor.close()
  }
  expect(detached).toHaveLength(1)
})

test("handoff cancels calls still awaiting their native claim before they can attach", async () => {
  const { createExecutor } = await import("../../../src/features/web-automation/worker.mjs")
  let authorize!: (response: Response) => void
  let attached = false
  const executor = createExecutor(
    async () => {
      attached = true
      throw Error("must not attach")
    },
    () =>
      new Promise<Response>((resolve) => {
        authorize = resolve
      })
  )
  const operation = executor.dispatch({
    version: 1,
    kind: "call",
    endpoint: "http://127.0.0.1:12345",
    transportToken: "application",
    sessionId: "a",
    token: "a-turn",
    name: "browser_evaluate",
    args: { target: "tab", expression: "document.title" }
  })
  const rejected = operation.catch((error) => error)
  const release = executor.dispatch({
    version: 1,
    kind: "releaseTarget",
    sessionId: "a",
    token: "a-turn",
    targets: ["tab"]
  })
  authorize(Response.json({ ok: true }))
  await release
  expect(String(await rejected)).toContain("canceled")
  expect(attached).toBe(false)
  await executor.close()
})
