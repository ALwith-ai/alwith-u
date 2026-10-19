import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, readdir } from "node:fs/promises"
import { join } from "node:path"
import manifest from "@alwith/module-computer/artifacts"

export function verifyComputerArtifact(bytes: Uint8Array, sha256: string): void {
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Cua Driver checksum mismatch")
}

export async function stageComputer(root: string, target: string): Promise<string> {
  const artifact = manifest.artifacts[target as keyof typeof manifest.artifacts]
  if (!artifact) throw new Error(`Cua Driver has no pinned artifact for ${target}`)
  const cache = join(root, "node_modules/.cache/alwith-computer", manifest.version)
  await mkdir(cache, { recursive: true })
  const archive = join(cache, artifact.archive)
  const file = Bun.file(archive)
  let bytes: Uint8Array
  if (await file.exists()) {
    bytes = new Uint8Array(await file.arrayBuffer())
  } else {
    const response = await fetch(artifact.url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`Cua Driver download failed: HTTP ${response.status}`)
    bytes = new Uint8Array(await response.arrayBuffer())
    verifyComputerArtifact(bytes, artifact.sha256)
    await Bun.write(archive, bytes)
  }
  verifyComputerArtifact(bytes, artifact.sha256)
  // Extract only the executable; the archive also contains SDKs we do not ship.
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
