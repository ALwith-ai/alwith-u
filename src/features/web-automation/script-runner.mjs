/**
 * Runs a Playwright script against one browser tab, under the conversation's own sandbox.
 *
 * The script is a separate process started through `codex sandbox` with the sandbox state the engine sent for
 * this tool call, so it has the permissions of the conversation's commands and nothing more. The one addition
 * is a Unix socket in a private directory. This process, which is outside the sandbox, serves that socket and
 * carries each connection to the DevTools endpoint of the one tab the call names, adding the credential the
 * script never sees.
 */
import { spawn } from "node:child_process"
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import net from "node:net"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

const OUTPUT_LIMIT = 32000
export const DEFAULT_TIMEOUT_MS = 60000
export const MAX_TIMEOUT_MS = 600000

/** Rewrites the first request of a connection so it can only open the authorized tab, then relays bytes. */
export function serveTab(socketPath, { host, port, path, token }) {
  const sockets = new Set()
  const server = net.createServer((client) => {
    sockets.add(client)
    let head = Buffer.alloc(0)
    let upstream
    const end = () => {
      sockets.delete(client)
      client.destroy()
      upstream?.destroy()
    }
    client.on("error", end)
    client.on("close", end)
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk])
      const boundary = head.indexOf("\r\n\r\n")
      if (boundary < 0) {
        if (head.length > 16384) end()
        return
      }
      client.off("data", onData)
      client.pause()
      const lines = head.subarray(0, boundary).toString("latin1").split("\r\n")
      const rest = head.subarray(boundary + 4)
      if (!/^GET \S+ HTTP\/1\.1$/.test(lines[0])) return end()
      const headers = lines.slice(1).filter((line) => !/^(host|authorization|origin|cookie):/i.test(line))
      const request = [
        `GET ${path} HTTP/1.1`,
        `Host: ${host}:${port}`,
        `Authorization: Bearer ${token}`,
        ...headers,
        "",
        ""
      ].join("\r\n")
      upstream = net.connect(port, host, () => {
        upstream.write(request)
        if (rest.length) upstream.write(rest)
        client.pipe(upstream)
        upstream.pipe(client)
        client.resume()
      })
      upstream.on("error", end)
      upstream.on("close", end)
    }
    client.on("data", onData)
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () =>
      resolve(
        () =>
          new Promise((closed) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => closed())
          })
      )
    )
  })
}

function bounded() {
  let text = ""
  let dropped = 0
  return {
    push(chunk) {
      const value = chunk.toString("utf8")
      const room = OUTPUT_LIMIT - text.length
      if (room >= value.length) text += value
      else {
        text += value.slice(0, Math.max(room, 0))
        dropped += value.length - Math.max(room, 0)
      }
    },
    read: () => (dropped ? `${text}\n[${dropped} more characters not shown]` : text)
  }
}

/**
 * @param {object} options
 * @param {string} [options.script] Absolute path of the script.
 * @param {string} [options.code] Source of the script, when it is not a file.
 * @param {unknown} options.sandboxState Opaque state from the engine, passed on unchanged.
 * @param {{host: string, port: number, path: string, token: string}} options.tab DevTools endpoint of the one tab.
 * @param {string} options.launcher Codex executable that applies the sandbox.
 * @param {string} options.runtime JavaScript runtime that runs the script.
 * @param {string} options.shim Module loaded before the script.
 * @param {number} options.timeoutMs
 * @param {(stop: () => void) => void} [options.onStart] Receives a function that stops the script.
 */
export async function runScript({ script, code, sandboxState, tab, launcher, runtime, shim, timeoutMs, onStart }) {
  if (script !== undefined && (!isAbsolute(script) || !(await stat(script).catch(() => null))?.isFile()))
    throw Error(`Not a script file: ${script}`)
  const cwdUri = sandboxState?.sandboxCwd
  if (typeof cwdUri !== "string" || !cwdUri.startsWith("file:"))
    throw Error("The conversation's sandbox names no working directory")
  for (const [name, path] of [
    ["sandbox launcher", launcher],
    ["script runtime", runtime],
    ["script loader", shim]
  ])
    if (!(await stat(path).catch(() => null))?.isFile()) throw Error(`The ${name} is missing: ${path}`)
  // The socket's directory is the only thing added to the sandbox, so it holds nothing else.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "u-browser-")))
  const socketPath = join(directory, "cdp.sock")
  let close
  try {
    // Whatever copy of Playwright the project has, the script gets the one the loader prepared.
    const shipped = (name) => dirname(createRequire(shim).resolve(`${name}/package.json`))
    const [core, full] = [shipped("playwright-core"), shipped("playwright")]
    const resolution = join(directory, "tsconfig.json")
    await writeFile(
      resolution,
      JSON.stringify({
        compilerOptions: {
          paths: {
            "playwright-core": [join(core, "index.js")],
            "playwright-core/*": [join(core, "*")],
            playwright: [join(full, "index.js")],
            "playwright/test": [join(full, "test.js")],
            "playwright/*": [join(full, "*")],
            "@playwright/test": [join(full, "test.js")]
          }
        }
      })
    )
    if (script === undefined) {
      script = join(directory, "script.mjs")
      await writeFile(script, code)
    }
    close = await serveTab(socketPath, tab)
    const child = spawn(
      launcher,
      [
        "sandbox",
        "--sandbox-state-json",
        JSON.stringify(sandboxState),
        "--allow-unix-socket",
        directory,
        "--",
        runtime,
        "--no-install",
        "--tsconfig-override",
        resolution,
        "--preload",
        shim,
        script
      ],
      {
        cwd: fileURLToPath(cwdUri),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          TMPDIR: process.env.TMPDIR,
          TEMP: process.env.TEMP,
          LANG: process.env.LANG,
          U_BROWSER_CDP: `ws+unix://${socketPath}:/tab`
        },
        stdio: ["ignore", "pipe", "pipe"],
        // The launcher starts the script as its child; stopping has to reach both.
        detached: process.platform !== "win32"
      }
    )
    const stdout = bounded()
    const stderr = bounded()
    child.stdout.on("data", stdout.push)
    child.stderr.on("data", stderr.push)
    let stopped = null
    const stop = (reason) => {
      stopped ??= reason
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
      else process.kill(-child.pid, "SIGKILL")
    }
    onStart?.(() => stop("canceled"))
    const timer = setTimeout(() => stop("timed out"), timeoutMs)
    const [exitCode, signal] = await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, exitSignal) => resolve([code, exitSignal]))
    }).finally(() => clearTimeout(timer))
    return {
      ok: exitCode === 0 && stopped === null,
      exitCode,
      ...(signal ? { signal } : {}),
      ...(stopped ? { stopped } : {}),
      stdout: stdout.read(),
      stderr: stderr.read(),
      cwd: fileURLToPath(cwdUri)
    }
  } finally {
    await close?.()
    await rm(directory, { recursive: true, force: true })
  }
}
