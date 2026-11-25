import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export async function stageBrowser(root: string): Promise<void> {
  const destination = join(root, "src-tauri/resources/browser")
  await mkdir(destination, { recursive: true })
  for (const name of [
    "definitions.mjs",
    "engine.mjs",
    "observation.mjs",
    "script-runner.mjs",
    "script-shim.mjs",
    "worker.mjs"
  ])
    await cp(join(root, "src/features/web-automation", name), join(destination, name))
  await rm(join(destination, "stdio.mjs"), { force: true })
  for (const name of ["playwright-core", "playwright"]) {
    const source = dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)))
    const installed = join(destination, "node_modules", name)
    await rm(installed, { recursive: true, force: true })
    await cp(source, installed, { recursive: true })
  }
}
if (import.meta.main) await stageBrowser(resolve(import.meta.dirname, ".."))
