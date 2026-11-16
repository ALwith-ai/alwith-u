/** Compile and test the same Rust application against each supported backend. */
import { resolve } from "node:path"

if (!["darwin", "win32"].includes(process.platform)) throw new Error("Only macOS and Windows are supported")
for (const features of ["runtime-wry", "experimental-cef", "dev-backends"]) {
  for (const args of [
    ["clippy", "--all-targets"],
    ["test", "--lib"]
  ]) {
    const child = Bun.spawn(
      ["cargo", ...args, "--no-default-features", "--features", `${features},hasgard-testing,tauri/custom-protocol`],
      {
        cwd: resolve(import.meta.dirname, "../src-tauri"),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit"
      }
    )
    if ((await child.exited) !== 0) throw new Error(`${features}: cargo ${args[0]} failed`)
  }
}
