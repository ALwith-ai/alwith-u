import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import manifest from "@alwith/module-computer/artifacts"

export function verifyComputerArtifact(bytes: Uint8Array, sha256: string): void {
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Cua Driver checksum mismatch")
}

export async function stageComputer(root: string, target: string): Promise<string> {
  const artifact = manifest.artifacts[target]
  if (!artifact) throw new Error(`Cua Driver has no pinned artifact for ${target}`)
  const archive = fileURLToPath(new URL(artifact.bundled, import.meta.resolve("@alwith/module-computer/artifacts")))
  const file = Bun.file(archive)
  if (!(await file.exists())) throw new Error(`Bundled Cua Driver artifact is missing: ${artifact.archive}`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  verifyComputerArtifact(bytes, artifact.sha256)
  // Stage the pinned executable from the package's platform archive.
  const process = Bun.spawn(["tar", "-xOf", archive, artifact.executable], { stdout: "pipe", stderr: "pipe" })
  const [binary, error, exit] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited
  ])
  if (exit !== 0 || binary.byteLength === 0) throw new Error(`Cannot extract Cua Driver: ${error}`)
  const destination = join(
    root,
    "src-tauri/binaries",
    `cua-driver-${target}${target.includes("windows") ? ".exe" : ""}`
  )
  await Bun.write(destination, binary)
  if (!target.includes("windows")) await chmod(destination, 0o755)
  const notices = join(root, "node_modules/@alwith/module-computer/licenses")
  const output = join(root, "src-tauri/resources/licenses/cua-driver")
  await mkdir(output, { recursive: true })
  for (const name of await readdir(notices)) await copyFile(join(notices, name), join(output, name))
  return destination
}
