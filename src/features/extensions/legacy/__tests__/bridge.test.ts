import { describe, expect, test } from "bun:test"
import { ResourceScope } from "@alwith/module-extension/host"
import { type BridgeDependencies, createLegacyBridge } from "../bridge"

function setup(
  extensionId = "yup-kb",
  grants = [{ scope: "grant", path: "/work" }],
  picked: { scope: string; path: string } | null = { scope: "grant", path: "/work" },
  imported = true
) {
  let selected: ReturnType<BridgeDependencies["session"]> = { id: "first", cwd: "/work", title: "First" }
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const notices: string[] = []
  const sent: { id: string; text: string }[] = []
  const scope = new ResourceScope()
  const dependencies: BridgeDependencies = {
    imported,
    binding: {
      manifest: {
        manifestVersion: 3,
        id: extensionId,
        name: extensionId,
        version: "1.0.0",
        entry: "main.js",
        dependencies: { "@alwith/module-extension": "^0.1.5" },
        hosts: {},
        dataSchemaVersion: 1
      },
      cancellation: scope.cancellation,
      own: dispose => scope.own(dispose)
    },
    native: async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args })
      if (command === "legacy_pick_directory") return picked as T
      if (command === "legacy_directories") return grants as T
      if (command === "legacy_http" || command === "extension_http")
        return { status: 200, url: "https://bi-api.finture.id/test", headers: {}, body: [0, 255, 42] } as T
      if (command === "legacy_file" || command === "extension_file") {
        const request = args.request as { operation: string; path: string }
        if (request.path.startsWith(".alwith/projects")) throw new Error("会话归档暂不支持，其他知识库功能可用")
        if (request.operation === "list") return { type: "list", entries: [] } as T
        if (request.operation === "read") return { type: "read", body: [] } as T
        return { type: "ok" } as T
      }
      throw new Error(`Unexpected ${command}`)
    },
    session: () => selected,
    send: async (id, text) => {
      sent.push({ id, text })
    },
    check: () => {},
    openView: () => {},
    notify: message => {
      notices.push(message)
      return { hide() {}, setMessage() {} }
    },
    language: () => "zh-CN",
    openExternal: async () => {},
    clipboard: async () => {},
    own: dispose => dispose,
    primary: true
  }
  return {
    bridge: createLegacyBridge(extensionId, dependencies),
    calls,
    sent,
    notices,
    dispose: () => scope.dispose(),
    clear: () => {
      selected = null
    },
    select: () => {
      selected = { id: "second", cwd: "/other", title: "Second" }
    }
  }
}

describe("legacy host boundary", () => {
  test("binds each plain chat send to the current session", async () => {
    const { bridge, sent, select } = setup("bi-metrics")
    bridge.captureChatContext()
    await bridge.sendMessage("first request")
    select()
    await bridge.sendMessage("second request")
    expect(sent).toEqual([
      { id: "first", text: "first request" },
      { id: "second", text: "second request" }
    ])
  })

  test("does not use the old captured chat when no chat is selected", async () => {
    const { bridge, sent, clear } = setup("bi-metrics")
    bridge.captureChatContext()
    clear()
    await expect(bridge.sendMessage("analyze")).rejects.toThrow("会话")
    expect(sent).toHaveLength(0)
  })

  test("does not retarget a send after it starts", async () => {
    const { bridge, sent, select } = setup("bi-metrics")
    const pending = bridge.sendMessage("analyze")
    select()
    await pending
    expect(sent).toEqual([{ id: "first", text: "analyze" }])
  })

  test("serializes multipart boundaries and retains binary responses", async () => {
    const { bridge, calls } = setup()
    const body = new FormData()
    body.append("file", new Blob([new Uint8Array([0, 255, 42])]), "report.bin")
    const response = await bridge.fetch("https://bi-api.finture.id/test", { method: "POST", body })
    const request = calls[0].args.request as { headers: Record<string, string>; body: number[] }
    expect(request.headers["content-type"]).toContain("multipart/form-data; boundary=")
    expect(new TextDecoder().decode(new Uint8Array(request.body))).toContain('filename="report.bin"')
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 255, 42])
  })

  test("rejects ungranted paths and traversal before a file operation", async () => {
    const { bridge, calls } = setup()
    await expect(bridge.invoke("plugin:fs|read_text_file", { path: "/work/../secret" })).rejects.toThrow()
    await expect(bridge.invoke("plugin:fs|read_text_file", { path: "/work-other/secret" })).rejects.toThrow()
    expect(calls.filter(call => call.command === "legacy_file")).toHaveLength(0)
  })

  test("maps legacy binary write headers to scoped native IO", async () => {
    const { bridge, calls } = setup()
    await bridge.invoke("plugin:fs|write_text_file", new TextEncoder().encode("你好"), {
      headers: { path: encodeURIComponent("/work/report.txt"), options: "{}" }
    })
    expect(calls.at(-1)?.args.request).toEqual({
      operation: "write",
      scope: "grant",
      path: "report.txt",
      body: Array.from(new TextEncoder().encode("你好"))
    })
  })

  test("does not fake session archival or unknown commands", async () => {
    const { bridge, calls } = setup()
    await expect(bridge.invoke("list_sessions", {})).rejects.toThrow("会话归档暂不支持")
    await expect(bridge.invoke("arbitrary_native_command", {})).rejects.toThrow("不支持")
    expect(calls).toHaveLength(0)
  })
})

test("legacy own directory maps to the migrated private root", async () => {
  const { bridge, calls } = setup()
  await bridge.invoke("plugin:fs|read_text_file", {
    path: "/__alwith_legacy/yup-kb/.alwith/extensions/yup-kb/workspaces.json"
  })
  expect(calls.at(-1)?.args.request).toEqual({ operation: "read", path: "workspaces.json" })
  await expect(
    bridge.invoke("plugin:fs|read_text_file", { path: "/__alwith_legacy/yup-kb/.alwith/extensions/another/data.json" })
  ).rejects.toThrow()
})

test("direct data.json IO shares SDK storage and never creates a second file", async () => {
  const { bridge, calls } = setup("generic-reader")
  let value: unknown = { theme: "light" }
  const release = bridge.bindStorage({
    exists: async () => true,
    read: async () => value as { theme: string },
    write: async next => {
      value = next
    },
    resource: path => `extension://test/${path}`
  })
  const path = "/__alwith_legacy/generic-reader/.alwith/extensions/generic-reader/data.json"
  const bytes = (await bridge.invoke("plugin:fs|read_text_file", { path })) as number[]
  expect(JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))).toEqual({ theme: "light" })
  await bridge.invoke("plugin:fs|write_text_file", new TextEncoder().encode('{"theme":"dark"}'), {
    headers: { path: encodeURIComponent(path) }
  })
  expect(value).toEqual({ theme: "dark" })
  const alias = (await bridge.invoke("plugin:fs|read_text_file", { path: "./data.json" })) as number[]
  expect(JSON.parse(new TextDecoder().decode(new Uint8Array(alias)))).toEqual({ theme: "dark" })
  await expect(
    bridge.invoke("plugin:fs|write_text_file", new TextEncoder().encode("broken"), {
      headers: { path: encodeURIComponent(path) }
    })
  ).rejects.toThrow()
  expect(value).toEqual({ theme: "dark" })
  expect(calls).toHaveLength(0)
  await bridge.invoke("plugin:fs|write_text_file", new TextEncoder().encode("null"), {
    headers: { path: encodeURIComponent(path) }
  })
  const nullBytes = (await bridge.invoke("plugin:fs|read_text_file", { path: "./data.json" })) as number[]
  expect(new TextDecoder().decode(new Uint8Array(nullBytes))).toBe("null")
  expect(await bridge.invoke("plugin:fs|stat", { path })).toMatchObject({ exists: true, size: 4 })
  release()
  await expect(bridge.invoke("plugin:fs|read_text_file", { path })).rejects.toThrow()
})

test("generic vault exports safe nested paths while ETMS retains its file contract", async () => {
  const generic = setup("generic-reader")
  generic.bridge.captureChatContext()
  await generic.bridge.vault.write("report.json", "{}")
  expect(generic.calls.at(-1)?.args.request).toMatchObject({ operation: "write", scope: "grant", path: "report.json" })
  await expect(generic.bridge.vault.write("../outside.json", "{}")).rejects.toThrow()
  const etms = setup("etms-strategy-review")
  etms.bridge.captureChatContext()
  await expect(etms.bridge.vault.write("report.json", "{}")).rejects.toThrow("ETMS")
  await etms.bridge.vault.write("etms-review-fixture.json", "{}")
  expect(etms.calls.at(-1)?.args.request).toMatchObject({ path: "etms-review-fixture.json" })
})

test("legacy file and network operations are revoked by the shared capability lifecycle", async () => {
  const { bridge, calls, dispose } = setup()
  await dispose()
  await expect(bridge.fetch("https://api.github.com/test")).rejects.toThrow("revoked")
  await expect(bridge.invoke("plugin:fs|read_text_file", { path: "notes.txt" })).rejects.toThrow("revoked")
  expect(calls).toHaveLength(0)
})

test("ETMS exports reuse the bound session directory grant without opening a picker", async () => {
  const { bridge, calls, sent, select, dispose } = setup("etms-strategy-review")
  try {
    bridge.captureChatContext()
    select()
    await bridge.vault.write("etms-review-fixture.json", "{}")
    await bridge.sendMessage("Analyze etms-review-fixture.json")
    expect(calls.some(call => call.command === "legacy_pick_directory")).toBe(false)
    expect(calls.find(call => call.command === "legacy_file")?.args.request).toEqual({
      operation: "write",
      scope: "grant",
      path: "etms-review-fixture.json",
      body: [123, 125]
    })
    expect(sent).toEqual([{ id: "first", text: "Analyze /work/etms-review-fixture.json" }])
  } finally {
    await dispose()
  }
})

test("ETMS asks for native directory authorization only when no exact workspace grant exists", async () => {
  const { bridge, calls, dispose } = setup("etms-strategy-review", [{ scope: "parent", path: "/" }])
  try {
    bridge.captureChatContext()
    await bridge.vault.write("etms-review-new.json", "{}")
    expect(calls.filter(call => call.command === "legacy_pick_directory")).toHaveLength(1)
    expect(calls.find(call => call.command === "legacy_file")?.args.request).toMatchObject({ scope: "grant" })
  } finally {
    await dispose()
  }
})

test.each([null, { scope: "wrong", path: "/other" }])(
  "ETMS does not write when directory authorization is cancelled or mismatched",
  async picked => {
    const { bridge, calls, dispose } = setup("etms-strategy-review", [], picked)
    try {
      bridge.captureChatContext()
      await expect(bridge.vault.write("etms-review-new.json", "{}")).rejects.toThrow()
      expect(calls.some(call => call.command === "legacy_file")).toBe(false)
    } finally {
      await dispose()
    }
  }
)

test("projects the current U workspace through read-only Desktop settings without granting files", async () => {
  const { bridge, calls, select } = setup()
  const appData = await bridge.invoke("plugin:path|resolve_directory", { directory: 4 })
  const path = `${appData}/ai.alwith.desktop/settings.json`
  const read = async (): Promise<unknown> => {
    const bytes = (await bridge.invoke("plugin:fs|read_text_file", { path })) as number[]
    return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))
  }
  expect(await read()).toEqual({
    "window.scopedState": { main: { lastOpenedWorkspace: { path: "/work" } } },
    recentWorkspaces: ["/work"]
  })
  select()
  expect(await read()).toMatchObject({ recentWorkspaces: ["/other"] })
  await expect(
    bridge.invoke("plugin:fs|write_text_file", new TextEncoder().encode("{}"), {
      headers: { path: encodeURIComponent(path) }
    })
  ).rejects.toThrow("只读")
  expect(calls).toHaveLength(0)
})

test("rejects background archival without showing a popup even when a parent is granted", async () => {
  const { bridge, calls, notices } = setup("yup-kb", [{ scope: "home", path: "/Users/example" }])
  for (const path of [
    "/__alwith_legacy/yup-kb/.alwith/projects",
    "/Users/example/.alwith/projects/project/session.jsonl"
  ]) {
    await expect(bridge.invoke("plugin:fs|read_dir", { path })).rejects.toThrow("会话归档暂不支持")
  }
  expect(notices).toEqual([])
  expect(calls.at(-1)?.args.request).toMatchObject({ path: ".alwith/projects/project/session.jsonl" })
})

test("formal plugins use common native IO and never request legacy migration", async () => {
  const { bridge, calls } = setup("new-plugin", [], null, false)
  expect(bridge.loadInitialData).toBeUndefined()
  expect(bridge.acknowledgeInitialData).toBeUndefined()
  await bridge.invoke("plugin:fs|read_text_file", { path: "notes.json" })
  await bridge.fetch("https://api.github.com/example")
  expect(calls.map(call => call.command)).toEqual(["extension_file", "extension_http"])
})

test("workspace projection represents no selected session and refuses other Desktop metadata", async () => {
  const { bridge, calls, clear } = setup()
  clear()
  const appData = await bridge.invoke("plugin:path|resolve_directory", { directory: 4 })
  const bytes = (await bridge.invoke("plugin:fs|read_text_file", {
    path: `${appData}/ai.alwith.desktop/settings.json`
  })) as number[]
  expect(JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))).toEqual({
    "window.scopedState": {},
    recentWorkspaces: []
  })
  await expect(
    bridge.invoke("plugin:fs|read_text_file", { path: `${appData}/ai.alwith.desktop/credentials.json` })
  ).rejects.toThrow("只读设置投影")
  expect(calls).toHaveLength(0)
})

test("does not confuse an authorized business directory with Desktop's actual archive", async () => {
  const { bridge, calls } = setup("yup-kb", [{ scope: "home", path: "/Users/example" }])
  expect(await bridge.invoke("plugin:fs|read_dir", { path: "/Users/example/business/.alwith/projects" })).toEqual([])
  expect(calls.at(-1)?.args.request).toMatchObject({ scope: "home", path: "business/.alwith/projects" })
})
