import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { runScript } from "../../../src/features/web-automation/script-runner.mjs"

const root = resolve(import.meta.dirname, "../../..")
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const launcher = join(root, "src-tauri/binaries/codex-aarch64-apple-darwin")
// The runtime the application ships, which resolves modules differently from a newer one.
const runtime = join(root, "src-tauri/binaries/bun-aarch64-apple-darwin")
// The real sandbox and a real browser: macOS with the staged Codex and Bun and an installed Chrome.
const available = process.platform === "darwin" && [chrome, launcher, runtime].every((path) => existsSync(path))

/** The state Codex sends for a conversation that may write its working directory and has no network. */
const sandboxFor = (cwd: string) => ({
  permissionProfile: {
    type: "managed",
    file_system: {
      type: "restricted",
      entries: [
        { path: { type: "special", value: { kind: "root" } }, access: "read" },
        { path: { type: "path", path: cwd }, access: "write" },
        { path: { type: "special", value: { kind: "tmpdir" } }, access: "write" }
      ]
    },
    network: "restricted"
  },
  codexLinuxSandboxExe: null,
  sandboxCwd: `file://${cwd}`,
  useLegacyLandlock: false,
  useMxc: false
})

test.skipIf(!available)(
  "an ordinary Playwright script drives the tab from inside the sandbox and can reach nothing else",
  async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "u-sandbox-test-")))
    const cwd = join(directory, "work")
    const outside = join(root, `.script-sandbox-probe-${process.pid}`)
    // A project's own Playwright would try to start a browser; the script must not get it.
    await Bun.write(join(cwd, "node_modules/playwright/package.json"), '{"name":"playwright","main":"index.js"}')
    await Bun.write(join(cwd, "node_modules/playwright/index.js"), 'throw Error("the project copy was loaded")')
    const browser = spawn(
      chrome,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${directory}/profile`,
        "--no-first-run",
        "about:blank"
      ],
      { stdio: "ignore" }
    )
    try {
      const active = join(directory, "profile/DevToolsActivePort")
      const started = Date.now()
      while (!existsSync(active) || readFileSync(active, "utf8").trim().split("\n").length !== 2) {
        if (Date.now() - started > 15000) throw Error("Chrome did not open its DevTools port")
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const [port, path] = readFileSync(active, "utf8").trim().split("\n") as [string, string]
      // Written the way scripts are: it launches a browser, makes two pages and closes everything.
      await writeFile(
        join(cwd, "check.cjs"),
        `const { chromium } = require("playwright")
const { expect } = require("@playwright/test")
const net = require("node:net")
const fs = require("node:fs")
;(async () => {
  const browser = await chromium.launch()
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } })
    const page = await context.newPage()
    await page.goto("data:text/html,<button onclick=\\"this.textContent='clicked '+innerWidth\\">go</button>")
    await page.getByRole("button").click()
    await expect(page.getByRole("button")).toHaveText("clicked " + width)
    await page.screenshot({ path: "shot-" + width + ".png" })
    await context.close()
  }
  const tcp = await new Promise((done) => {
    const socket = net.connect(${port}, "127.0.0.1", () => done("reached"))
    socket.on("error", (error) => done(error.code))
  })
  let write = "written"
  try { fs.writeFileSync(${JSON.stringify(outside)}, "x") } catch (error) { write = error.code }
  console.log(JSON.stringify({ tcp, write }))
  await browser.close()
})().catch((error) => { console.error(String(error)); process.exit(1) })
`
      )
      const result = await runScript({
        script: join(cwd, "check.cjs"),
        sandboxState: sandboxFor(cwd),
        tab: { host: "127.0.0.1", port: Number(port), path, token: "unused" },
        launcher,
        runtime,
        shim: join(root, "src/features/web-automation/script-shim.mjs"),
        timeoutMs: 60000
      })
      expect(result).toMatchObject({ ok: true, exitCode: 0, stderr: "" })
      // The browser's own port and a file outside the working directory are both out of reach.
      expect(JSON.parse(result.stdout)).toEqual({ tcp: "ECONNREFUSED", write: "EPERM" })
      expect((await stat(join(cwd, "shot-390.png"))).size).toBeGreaterThan(1000)
      expect((await stat(join(cwd, "shot-1280.png"))).size).toBeGreaterThan(1000)
      expect(existsSync(outside)).toBe(false)

      const module = await runScript({
        code: `import { chromium } from "playwright-core"
const page = await (await chromium.launch()).newPage()
await page.goto("data:text/html,<title>module</title>")
console.log(await page.title())
process.exit(0)`,
        sandboxState: sandboxFor(cwd),
        tab: { host: "127.0.0.1", port: Number(port), path, token: "unused" },
        launcher,
        runtime,
        shim: join(root, "src/features/web-automation/script-shim.mjs"),
        timeoutMs: 60000
      })
      expect(module).toMatchObject({ ok: true, stdout: "module\n", stderr: "" })

      await writeFile(
        join(cwd, "forever.cjs"),
        `require("playwright").chromium.launch().then(() => setInterval(() => {}, 1000))`
      )
      const stuck = await runScript({
        script: join(cwd, "forever.cjs"),
        sandboxState: sandboxFor(cwd),
        tab: { host: "127.0.0.1", port: Number(port), path, token: "unused" },
        launcher,
        runtime,
        shim: join(root, "src/features/web-automation/script-shim.mjs"),
        timeoutMs: 3000
      })
      expect(stuck).toMatchObject({ ok: false, stopped: "timed out" })
    } finally {
      // Chrome writes its profile until it is gone; remove the directory only then.
      const exited = new Promise((resolve) => browser.once("exit", resolve))
      browser.kill()
      await exited
      await rm(outside, { force: true })
      await rm(directory, { recursive: true, force: true })
    }
  },
  120000
)
