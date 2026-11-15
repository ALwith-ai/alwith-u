// Put a CEF framework into a Tauri macOS bundle and sign the bundle again.
//
// A distribution (CEF_DIR, the directory the bindings downloaded or an SDK) is copied as it is. A
// component build (CEF_SURFACE_BUILD, an output directory of a local Chromium build) is laid over
// the distribution's framework: its many libraries go beside the framework's binary.
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

const [bundleArgument] = process.argv.slice(2)
const sdk = process.env.CEF_DIR ?? process.env.CEF_SURFACE_SDK
const components = process.env.CEF_SURFACE_BUILD
if (!bundleArgument || !sdk) {
  throw new Error("Usage: CEF_DIR=… [CEF_SURFACE_BUILD=…] bun scripts/cef-framework.ts <app bundle>")
}
if (process.platform !== "darwin") throw new Error("This installer requires macOS")
const app = resolve(bundleArgument)
const name = "Chromium Embedded Framework.framework"
const destination = join(app, "Contents/Frameworks", name)
for (const path of [join(app, "Contents/MacOS/alwith-u"), join(sdk, name, "Chromium Embedded Framework")]) {
  await stat(path)
}
async function run(args: string[]) {
  const child = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" })
  if (await child.exited) throw new Error(`Command failed: ${args[0]}`)
}
// Prepare next to the final framework so interruption cannot leave a partial copy in its place.
const staged = `${destination}.staging`
await rm(staged, { recursive: true, force: true })
await mkdir(join(app, "Contents/Frameworks"), { recursive: true })
await run(["cp", "-cR", join(sdk, name), staged])
if (components) {
  const source = join(components, name)
  await stat(join(source, "Chromium Embedded Framework"))
  for (const directory of ["Resources", "Libraries"]) {
    await rm(join(staged, directory), { recursive: true, force: true })
    await cp(join(source, directory), join(staged, directory), { recursive: true, dereference: true })
  }
  await run(["cp", "-c", join(source, "Chromium Embedded Framework"), join(staged, "Chromium Embedded Framework")])
  for (const library of await readdir(components)) {
    if (library.endsWith(".dylib")) await run(["cp", "-c", join(components, library), join(staged, basename(library))])
  }
}
await rm(destination, { recursive: true, force: true })
await run(["mv", staged, destination])
if (components) {
  await cp(join(components, "args.gn"), join(app, "Contents/Resources/cef-build-args.gn"))
  // The component sandbox library moves from the build root into Libraries. Its
  // @rpath dependencies remain in the framework root, including seatbelt and libc++.
  const sandbox = join(destination, "Libraries/libcef_sandbox.dylib")
  const loadCommands = Bun.spawn(["otool", "-l", sandbox], { stdout: "pipe", stderr: "inherit" })
  const commands = await new Response(loadCommands.stdout).text()
  if (await loadCommands.exited) throw new Error("Cannot inspect the sandbox library")
  if (!commands.includes("path @loader_path/.. ("))
    await run(["install_name_tool", "-add_rpath", "@loader_path/..", sandbox])
}
await run(["codesign", "--force", "--deep", "--sign", "-", app])
await run(["codesign", "--verify", "--deep", "--strict", app])
console.log(app)
