import { describe, expect, test } from "bun:test"
import { createLegacyBridge, type BridgeDependencies } from "../bridge"

function setup() {
  let selected = { id: "first", cwd: "/work", title: "First" }
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const sent: { id: string; text: string }[] = []
  const dependencies: BridgeDependencies = {
    native: async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args })
      if (command === "legacy_directories") return [{ scope: "grant", path: "/work" }] as T
      if (command === "legacy_http")
        return { status: 200, url: "https://bi-api.finture.id/test", headers: {}, body: [0, 255, 42] } as T
      if (command === "legacy_file") return { type: "ok" } as T
      throw new Error(`Unexpected ${command}`)
    },
    session: () => selected,
    send: async (id, text) => {
      sent.push({ id, text })
    },
    check: () => {},
    openView: () => {},
    notify: () => ({ hide() {}, setMessage() {} }),
    language: () => "zh-CN",
    openExternal: async () => {},
    clipboard: async () => {},
    own: dispose => dispose,
    primary: true
  }
  return {
    bridge: createLegacyBridge("yup-kb", dependencies),
    calls,
    sent,
    select: () => {
      selected = { id: "second", cwd: "/other", title: "Second" }
    }
  }
}

describe("legacy host boundary", () => {
  test("binds a chat explicitly and never retargets an in-flight operation", async () => {
    const { bridge, sent, select } = setup()
    bridge.captureChatContext()
    select()
    bridge.captureChatContext()
    await bridge.sendMessage("analyze")
    expect(sent).toEqual([{ id: "first", text: "analyze" }])
  })

  test("does not infer a destination at send time", async () => {
    const { bridge, sent } = setup()
    await expect(bridge.sendMessage("analyze")).rejects.toThrow("会话")
    expect(sent).toHaveLength(0)
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
