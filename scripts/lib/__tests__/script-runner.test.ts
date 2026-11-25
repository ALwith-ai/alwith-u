import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { runScript, serveTab } from "../../../src/features/web-automation/script-runner.mjs"

test("the socket opens only the authorized tab, with a credential the script never holds", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "u-runner-test-")))
  const received: string[] = []
  const upstream = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      received.push(chunk.toString("latin1"))
      socket.write("HTTP/1.1 101 Switching Protocols\r\n\r\nframes")
    })
  })
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const { port } = upstream.address() as net.AddressInfo
  const close = await serveTab(join(directory, "cdp.sock"), {
    host: "127.0.0.1",
    port,
    path: "/cdp/tab-1",
    token: "secret"
  })
  try {
    const reply = await new Promise<string>((resolve, reject) => {
      const client = net.connect(join(directory, "cdp.sock"), () =>
        client.write(
          "GET /cdp/another-tab HTTP/1.1\r\nHost: evil\r\nAuthorization: Bearer forged\r\nUpgrade: websocket\r\nSec-WebSocket-Key: k\r\n\r\n"
        )
      )
      client.once("data", (chunk) => resolve(chunk.toString("latin1")))
      client.once("error", reject)
    })
    expect(reply).toContain("101 Switching Protocols")
    expect(received).toEqual([
      `GET /cdp/tab-1 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer secret\r\nUpgrade: websocket\r\nSec-WebSocket-Key: k\r\n\r\n`
    ])
    // Anything that is not one upgrade request is dropped before it reaches the browser.
    await new Promise<void>((resolve) => {
      const client = net.connect(join(directory, "cdp.sock"), () => client.write("POST /json/new HTTP/1.1\r\n\r\n"))
      client.once("close", () => resolve())
    })
    expect(received).toHaveLength(1)
  } finally {
    await close()
    await new Promise((resolve) => upstream.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test("a script is not started without its file, a working directory, or the programs that confine and run it", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "u-runner-test-")))
  const present = join(directory, "present")
  await writeFile(present, "")
  const options = {
    code: "1",
    sandboxState: { sandboxCwd: `file://${directory}` },
    tab: { host: "127.0.0.1", port: 1, path: "/cdp/tab", token: "t" },
    launcher: present,
    runtime: present,
    shim: present,
    timeoutMs: 1000
  }
  try {
    await expect(runScript({ ...options, code: undefined, script: join(directory, "missing.mjs") })).rejects.toThrow(
      "Not a script file"
    )
    await expect(runScript({ ...options, sandboxState: {} })).rejects.toThrow("names no working directory")
    await expect(runScript({ ...options, launcher: join(directory, "missing") })).rejects.toThrow(
      "sandbox launcher is missing"
    )
    await expect(runScript({ ...options, shim: join(directory, "missing") })).rejects.toThrow(
      "script loader is missing"
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
