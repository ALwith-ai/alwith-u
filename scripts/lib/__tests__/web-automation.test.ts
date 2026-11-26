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

test("an opened tab is answered once its page can be read, and says so when it cannot", async () => {
  const waits: unknown[] = []
  let address = "about:blank"
  let dialogs: ((dialog: unknown) => void) | undefined
  let arrive: () => void = () => {}
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    on(event: string, listener: (dialog: unknown) => void) {
      if (event === "dialog") dialogs = listener
    },
    url: () => address,
    waitForURL(accepts: (url: URL) => boolean, options: unknown) {
      waits.push(options)
      expect(accepts(new URL("about:blank"))).toBe(false)
      expect(accepts(new URL("https://example.com/"))).toBe(true)
      return new Promise<void>((resolve) => {
        arrive = resolve
      })
    }
  }
  const run = createBrowserTools(
    async () => ({ target: "browser-new" }),
    async () => ({ contexts: () => [{ pages: () => [page] }], on() {}, close: async () => {} }) as unknown as Browser
  )
  try {
    let answered = false
    const opened = run("browser_open", { url: "https://example.com" }).then((result: unknown) => {
      answered = true
      return result
    })
    await Bun.sleep(0)
    expect(answered).toBe(false)
    expect(waits).toEqual([{ waitUntil: "domcontentloaded" }])
    address = "https://example.com/"
    arrive()
    expect(await opened).toEqual({ target: "browser-new" })

    address = "chrome-error://chromewebdata/"
    const unreachable = run("browser_open", { url: "https://unreachable.example" })
    await Bun.sleep(0)
    arrive()
    await expect(unreachable).rejects.toThrow(
      "browser-new is open but https://unreachable.example/ could not be reached"
    )

    // A page that asks something while it loads is open: the question is answered, not waited out.
    address = "about:blank"
    const asking = run("browser_open", { url: "https://example.com" })
    await Bun.sleep(0)
    dialogs!({ type: () => "confirm", message: () => "Leave?", defaultValue: () => "" })
    expect(await asking).toEqual({
      target: "browser-new",
      pending: true,
      dialog: { id: 1, type: "confirm", message: "Leave?", defaultValue: "" }
    })
  } finally {
    await run.close()
  }
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

test("a script needs a file or source, a sane time limit, and takes the tab over from this process", async () => {
  let closed = 0
  const page = {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    on() {},
    frames: () => [],
    mainFrame: () => ({}),
    url: () => "about:blank"
  }
  const browser = {
    contexts: () => [{ pages: () => [page] }],
    on() {},
    close: async () => void closed++
  } as unknown as Browser
  const started: unknown[] = []
  const run = createBrowserTools(
    async () => ({}),
    async () => browser,
    {
      runScript: async (target: string, args: Record<string, unknown>) => (
        started.push([target, args, closed]),
        { ok: true }
      )
    }
  )
  await expect(run("browser_run", { target: "guest" })).rejects.toThrow("either script or code")
  await expect(run("browser_run", { target: "guest", script: "/a.mjs", code: "1" })).rejects.toThrow("either")
  await expect(run("browser_run", { target: "guest", script: "relative.mjs" })).rejects.toThrow("absolute path")
  await expect(run("browser_run", { target: "guest", code: "  " })).rejects.toThrow("empty")
  await expect(run("browser_run", { target: "guest", code: "1", timeoutMs: 5 })).rejects.toThrow("timeout")
  expect(started).toEqual([])
  // Attach this process to the tab, then run a script: the script must find the tab free.
  await run("browser_diagnostics", { target: "guest" })
  expect(await run("browser_run", { target: "guest", code: "1" })).toEqual({ ok: true })
  expect(started).toEqual([["guest", { target: "guest", code: "1" }, 1]])
  await expect(createBrowserTools(async () => ({}))("browser_run", { target: "guest", code: "1" })).rejects.toThrow(
    "cannot run"
  )
})

test("a script runs under the engine's sandbox, against its one tab, and stops when the tab is released", async () => {
  const { createExecutor } = await import("../../../src/features/web-automation/worker.mjs")
  const runs: Record<string, any>[] = []
  let stopped = 0
  let finish!: (value: unknown) => void
  const executor = createExecutor(
    undefined,
    async () => Response.json({}),
    (options: Record<string, any>) => {
      runs.push(options)
      options.onStart(() => {
        stopped++
        finish({ ok: false, stopped: "canceled" })
      })
      return new Promise((resolve) => (finish = resolve))
    }
  )
  const request = {
    version: 1,
    kind: "call",
    endpoint: "http://127.0.0.1:12345",
    sessionId: "a",
    token: "token-a",
    transportToken: "host",
    name: "browser_run",
    args: { target: "guest 1", code: "1" }
  }
  try {
    // Without a sandbox from the engine nothing is started: there is no unsandboxed way to run a script.
    await expect(executor.dispatch(request)).rejects.toThrow("stated no sandbox")
    expect(runs).toEqual([])
    const state = { sandboxCwd: "file:///work" }
    const running = executor.dispatch({ ...request, args: { ...request.args, sandboxState: state } })
    // The claim is one awaited native call; the script starts on a turn after it resolves.
    while (runs.length === 0) await new Promise((resolve) => setTimeout(resolve, 1))
    expect(runs[0]).toMatchObject({
      code: "1",
      sandboxState: state,
      tab: { host: "127.0.0.1", port: 12345, path: "/cdp/guest%201", token: "host" },
      timeoutMs: 60000
    })
    expect(runs[0]!.launcher).toMatch(/codex(\.exe)?$/)
    await executor.dispatch({
      version: 1,
      kind: "releaseTarget",
      sessionId: "a",
      token: "token-a",
      targets: ["guest 1"]
    })
    expect(stopped).toBe(1)
    expect(await running).toEqual({ ok: false, stopped: "canceled" })
  } finally {
    await executor.close()
  }
})
