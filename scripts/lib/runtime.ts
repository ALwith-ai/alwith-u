// Runs the staged alwith-runtime over WebSocket for scripts and live checks (Bun only).
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { createInterface } from "node:readline"

const root = resolve(import.meta.dirname, "../..")
const TRIPLES = ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"]

export function staged(name: string): string {
  const platform =
    process.platform === "darwin" ? "apple-darwin" : process.platform === "linux" ? "unknown-linux-gnu" : null
  const architecture = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null
  const triple = `${architecture}-${platform}`
  if (!TRIPLES.includes(triple)) throw new Error(`Unsupported live-test host: ${process.platform}/${process.arch}`)
  const binary = resolve(root, `src-tauri/binaries/${name}-${triple}`)
  if (!existsSync(binary)) throw new Error(`No staged ${name} binary at ${binary}; run \`bun run stage\``)
  return binary
}

export type RunningRuntime = { url: string; token: string; process: ChildProcess; stop(): void }

export function stagedCodexEngine(): { command: string; args: string[]; env: { CODEX_PATH: string } } {
  const adapter = resolve(root, "src-tauri/resources/adapter/codex-acp-v2.mjs")
  if (!existsSync(adapter)) throw new Error("No staged ACP adapter; run `bun run stage`")
  return { command: staged("bun"), args: ["--no-install", adapter], env: { CODEX_PATH: staged("codex") } }
}

/** Starts alwith-runtime (ws mode) with the staged Codex sidecars as its only engine and waits for `ready`. */
export async function startRuntime(journalRoot: string): Promise<RunningRuntime> {
  const token = crypto.randomUUID()
  const engines = { codex: stagedCodexEngine() }
  const child = spawn(staged("alwith-runtime"), ["--listen", "ws://"], {
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      ALWITH_RUNTIME_TOKEN: token,
      ALWITH_RUNTIME_ENGINES: JSON.stringify(engines),
      ALWITH_RUNTIME_JOURNAL: journalRoot,
      ALWITH_RUNTIME_PARENT_PID: String(process.pid)
    }
  })
  const lines = createInterface({ input: child.stdout! })
  const url = await new Promise<string>((resolveUrl, reject) => {
    child.once("exit", code => reject(new Error(`alwith-runtime exited before ready (code ${code})`)))
    lines.on("line", line => {
      try {
        const value = JSON.parse(line) as { type?: string; url?: string }
        if (value.type === "ready" && typeof value.url === "string") resolveUrl(value.url)
      } catch {
        // only JSON on stdout in ws mode, but stay tolerant.
      }
    })
  })
  return {
    url,
    token,
    process: child,
    stop() {
      child.kill("SIGTERM")
    }
  }
}
