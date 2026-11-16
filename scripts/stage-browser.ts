import { fileURLToPath } from "node:url"
import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

export async function stageBrowser(root: string) {
  const destination = join(root, "src-tauri/resources/browser")
  await mkdir(destination, { recursive: true })
  for (const name of ["definitions.mjs", "engine.mjs", "worker.mjs"])
    await cp(join(root, "src/features/web-automation", name), join(destination, name))
  await rm(join(destination, "stdio.mjs"), { force: true })
  const source = dirname(fileURLToPath(import.meta.resolve("playwright-core/package.json")))
  const installed = join(destination, "node_modules/playwright-core")
  await rm(installed, { recursive: true, force: true })
  if (process.platform === "darwin") await cp(source, installed, { recursive: true })
}
if (import.meta.main) await stageBrowser(resolve(import.meta.dirname, ".."))
