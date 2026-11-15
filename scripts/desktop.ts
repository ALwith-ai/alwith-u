/** Platform policy for normal desktop entry points. */
import { desktopArgs } from "./lib/desktop-build"
const [mode, ...extra] = process.argv.slice(2)
const args = desktopArgs(process.platform, mode, extra)
const child = Bun.spawn(["bun", "tauri", ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
process.exit(await child.exited)
