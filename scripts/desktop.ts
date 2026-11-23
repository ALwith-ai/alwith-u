import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { desktopArgs } from "./lib/desktop-build"
import { instanceArguments, instanceName, instanceWorkspace } from "./lib/desktop-instance"

/** Platform policy for normal desktop entry points. */
const [mode, ...extra] = process.argv.slice(2)
const args = desktopArgs(process.platform, mode, extra)
const development = mode === "dev" || extra.includes("--debug")
const instance = instanceArguments(extra).instance ?? 1
const cwd = development
  ? await instanceWorkspace(resolve(import.meta.dirname, ".."), instance)
  : resolve(import.meta.dirname, "..")
if (development) console.log(`ALwith U ${instanceName(instance)}: ${cwd}`)
let buildPath = process.env.PATH ?? ""
if (process.platform === "win32" && !Bun.which("ninja")) {
  const vswhere = join(
    process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
    "Microsoft Visual Studio/Installer/vswhere.exe"
  )
  if (!existsSync(vswhere)) throw Error("CEF builds require Ninja on PATH or Visual Studio's CMake tools")
  const result = Bun.spawnSync([
    vswhere,
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.CMake.Project",
    "-property",
    "installationPath"
  ])
  if (result.exitCode !== 0) throw Error(`Cannot locate Visual Studio CMake tools: ${result.stderr.toString()}`)
  const installation = result.stdout.toString().trim()
  const ninjaDirectory = join(installation, "Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja")
  if (!installation || !existsSync(join(ninjaDirectory, "ninja.exe")))
    throw Error("Install Visual Studio CMake tools or add Ninja to PATH before building CEF")
  buildPath = `${ninjaDirectory};${buildPath}`
}
const child = Bun.spawn(["bun", "tauri", ...args], {
  cwd,
  env: {
    ...process.env,
    PATH: buildPath,
    CEF_PATH: resolve(
      cwd,
      "target/cef-h264-aac",
      process.platform === "darwin" ? "cef_macos_aarch64" : "cef_windows_x86_64"
    ),
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
