import { fileURLToPath } from "node:url"
import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

export async function stageBrowser(root: string) {
  const destination = join(root, "src-tauri/resources/browser")
  await mkdir(destination, { recursive: true })
  await cp(join(root, "scripts/browser-mcp.mjs"), join(destination, "stdio.mjs"))
  const source = dirname(fileURLToPath(import.meta.resolve("playwright-core/package.json")))
  const installed = join(destination, "node_modules/playwright-core")
  await rm(installed, { recursive: true, force: true })
  if (process.platform === "darwin") await cp(source, installed, { recursive: true })
}
if (import.meta.main) await stageBrowser(resolve(import.meta.dirname, ".."))
