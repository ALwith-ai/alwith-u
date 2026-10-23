import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { pipeline, Readable } from "node:stream"
import { zstdDecompressSync } from "node:zlib"

// Exercise the installed adapter patch without launching an agent or reading credentials.
const bundle = readFileSync(
  new URL("../../../node_modules/@nyssance/codex-acp-v2/dist/index.js", import.meta.url),
  "utf8"
)
const source = bundle.slice(
  bundle.indexOf("var MAX_BODY_BYTES ="),
  bundle.indexOf("// src/alwith/codex/responsesRoutes.ts")
)
interface ProxyInstance {
  route(url: string): Promise<string>
  close(): void
}
function proxy(forward: (url: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>): ProxyInstance {
  const create = new Function(
    "fetch",
    "createServer",
    "randomBytes",
    "pipeline",
    "ResponsesReadable",
    "zstdDecompressSync",
    "compatibleResponsesRequest",
    "import_websocket_server",
    `${source}; return new ResponsesProxy()`
  )
  return create(
    forward,
    createServer,
    randomBytes,
    pipeline,
    Readable,
    zstdDecompressSync,
    (body: string) => body,
    { default: class { close() {} } }
  ) as ProxyInstance
}

test("Responses transport preserves streaming bytes, status and request cancellation options", async () => {
  let options: RequestInit & { decompress?: boolean } = {}
  let target = ""
  const instance = proxy(async (url, init) => {
    target = String(url)
    options = init ?? {}
    return new Response("data: hello\n\ndata: [DONE]\n\n", {
      status: 201,
      headers: { "content-type": "text/event-stream" }
    })
  })
  try {
    const base = await instance.route("https://example.test/v1")
    const response = await fetch(`${base}/responses`, {
      method: "POST",
      body: '{"input":[]}',
      headers: { "content-type": "application/json" }
    })
    expect(response.status).toBe(201)
    expect(await response.text()).toBe("data: hello\n\ndata: [DONE]\n\n")
    expect(target).toBe("https://example.test/v1/responses")
    expect(options.redirect).toBe("manual")
    expect(options.decompress).toBe(false)
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(Buffer.from(options.body as Uint8Array).toString()).toBe('{"input":[]}')
  } finally {
    instance.close()
  }
})

test("Responses transport exposes safe error codes without credentials or upstream URLs", async () => {
  const instance = proxy(async () => {
    throw Object.assign(new Error("https://secret:token@example.test"), { code: "ECONNREFUSED" })
  })
  try {
    const base = await instance.route("https://example.test/v1")
    const response = await fetch(`${base}/responses`, { method: "POST", body: '{"input":[]}' })
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).toContain("ECONNREFUSED")
    expect(body).not.toContain("secret")
    expect(body).not.toContain("example.test")
  } finally {
    instance.close()
  }
})
