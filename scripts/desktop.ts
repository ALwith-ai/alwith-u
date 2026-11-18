import { resolve } from "node:path"

/** Platform policy for normal desktop entry points. */
import { desktopArgs } from "./lib/desktop-build"
import { instanceArguments, instanceName, instanceWorkspace } from "./lib/desktop-instance"
const [mode, ...extra] = process.argv.slice(2)
const args = desktopArgs(process.platform, mode, extra)
const development = mode === "dev" || extra.includes("--debug")
const instance = instanceArguments(extra).instance ?? 1
const cwd = development
  ? await instanceWorkspace(resolve(import.meta.dirname, ".."), instance)
  : resolve(import.meta.dirname, "..")
if (development) console.log(`ALwith U ${instanceName(instance)}: ${cwd}`)
const child = Bun.spawn(["bun", "tauri", ...args], {
  cwd,
  env: {
    ...process.env,
    CEF_PATH: resolve(cwd, "target/cef-h264-aac/158.0.25", process.platform === "darwin" ? "cef_macos_aarch64" : "cef_windows_x86_64"),
    ...(development
      ? {
          ALWITH_DEV_PORT: String(1400 + instance),
          CARGO_TARGET_DIR: resolve(cwd, `src-tauri/target-dev${instance}`)
        }
      : {})
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
})
process.exit(await child.exited)
