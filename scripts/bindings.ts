import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
async function output(command: string[], stdin?: string): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: root,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "inherit"
  })
  const text = await new Response(child.stdout).text()
  if ((await child.exited) !== 0) throw new Error(`Binding generation failed: ${command.join(" ")}`)
  return text
}
const source = await output([
  "cargo",
  "run",
  "--locked",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--example",
  "export_bindings"
])
const formatted = await output(["bun", "fmt", "--stdin-filepath=src/bindings.ts"], source)
const path = resolve(root, "src/bindings.ts")
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== formatted) throw new Error("Native bindings are stale; run bun run bindings")
  console.log("Native bindings match Rust commands and events")
} else {
  await writeFile(path, formatted)
  console.log("Updated src/bindings.ts")
}
