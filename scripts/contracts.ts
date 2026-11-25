#!/usr/bin/env bun
// Runs contracts against a test application this script builds, starts and stops:
//
//   bun run contracts <browser|shell> [vitest arguments, such as a contract file or -t <step>]
//
// `browser` is the test application showing the isolated browser workspace; `shell` is the one showing
// the shell test page. The application is bundled first, because CEF and its helper applications are
// loaded from the bundle, and the bundle is built from the working tree so that a contract never runs
// against an older build. It has its own identity and a disposable profile, and is stopped when the
// contracts end. The ordinary frontend is rebuilt afterwards: bundling replaces it with the test one.
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const [fixture, ...vitestArguments] = process.argv.slice(2)
if (fixture !== "browser" && fixture !== "shell")
  throw Error("Use: bun run contracts <browser|shell> [vitest arguments]")
if (process.platform !== "darwin") throw Error("The test application is bundled on macOS only")

const name = "ALwith U Contract Test"
const executable = join(root, "src-tauri/target/debug/bundle/macos", `${name}.app`, "Contents/MacOS/alwith-u")
const socket = join(tmpdir(), `u-contract-${process.pid}.sock`)

async function run(command: string[], env: Record<string, string> = {}): Promise<number> {
  return Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  }).exited
}

/** One Hasgard call to the test application; rejects while it is not listening yet. */
function ask(script: string): Promise<unknown> {
  return new Promise((done, fail) => {
    const connection = connect(socket)
    let reply = ""
    connection.on("error", fail)
    connection.on("connect", () =>
      connection.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eval", params: { window: "main", script } })}\n`
      )
    )
    connection.on("data", (data) => {
      reply += String(data)
      if (!reply.includes("\n")) return
      connection.end()
      done((JSON.parse(reply.split("\n")[0]) as { result?: unknown }).result)
    })
  })
}

const built = await run(
  [
    "bun",
    "tauri",
    "build",
    "--debug",
    "--bundles",
    "app",
    "--features",
    "dev-backends,hasgard-testing,tauri/custom-protocol",
    "--config",
    JSON.stringify({
      identifier: "ai.alwith.u.contract-test",
      productName: name,
      bundle: { createUpdaterArtifacts: false, macOS: { signingIdentity: null, hardenedRuntime: false } }
    }),
    "--",
    "--no-default-features"
  ],
  { CEF_PATH: join(root, "target/cef-h264-aac"), ALWITH_NATIVE_TEST: "1" }
)
let code = built
if (built === 0) {
  const profile = await mkdtemp(join(tmpdir(), "u-contract-profile-"))
  const application = Bun.spawn([executable], {
    env: {
      ...process.env,
      ALWITH_U_CEF_SHELL_TEST: "1",
      ...(fixture === "browser" ? { ALWITH_U_CEF_BROWSER_TEST: "1" } : {}),
      ALWITH_U_CEF_TEST_PROFILE: profile,
      TAURI_HASGARD_DISPLAY: process.env.TAURI_HASGARD_DISPLAY ?? "secondary",
      TAURI_HASGARD_SOCKET: socket
    },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit"
  })
  try {
    // Ready is the application's own answer: its main window shows the page the fixture names.
    const page = fixture === "browser" ? "browser-fixture.html" : "native-shell-test.html"
    const deadline = Date.now() + 120_000
    for (;;) {
      // A second instance of one application hands over to the first and exits at once, with success.
      if (application.exitCode !== null)
        throw Error(
          `The test application exited before it was ready (code ${application.exitCode}); is another one running?`
        )
      const shown = existsSync(socket) ? await ask("location.pathname").catch(() => undefined) : undefined
      if (typeof shown === "string" && shown.includes(page)) break
      if (Date.now() > deadline) throw Error(`The test application did not show ${page} (last: ${String(shown)})`)
      await Bun.sleep(250)
    }
    code = await run(["bun", "--bun", "vitest", "run", "--config", "vitest.contracts.config.ts", ...vitestArguments], {
      TAURI_HASGARD_SOCKET: socket
    })
  } finally {
    application.kill()
    await application.exited
    await rm(profile, { recursive: true, force: true })
    await rm(socket, { force: true })
  }
}
// Bundling built the test frontend into dist; the development application expects the ordinary one.
const restored = await run(["bun", "run", "build"])
process.exit(code !== 0 ? code : restored)
