import { readdirSync, readFileSync, lstatSync } from "node:fs"
import { join } from "node:path"
import { valid } from "semver"

type Artifact = {
  download_url: string
  target: string
  arch: string
  format: string
  label: string
  signature_text: string
}

export function releaseVersion(tag: string): string {
  const version = tag.slice(1)
  if (!tag.startsWith("v") || valid(version) !== version) throw new Error("Expected a v<semver> release tag")
  return version
}

export function releaseArtifacts(directory: string, tag: string): Artifact[] {
  const version = releaseVersion(tag)
  const artifacts: Artifact[] = []
  for (const filename of readdirSync(directory).sort()) {
    if (!/\.(dmg|exe|msi|app\.tar\.gz)$/.test(filename)) continue
    const prefix = `alwith-u_${version}_`
    if (!filename.startsWith(prefix)) throw new Error(`Asset version does not match ${tag}: ${filename}`)
    const match = /^(macos|windows)_(aarch64|arm64|x64|x86_64)(\.dmg|\.app\.tar\.gz|-setup\.exe|\.msi)$/.exec(
      filename.slice(prefix.length)
    )
    if (!match) throw new Error(`Unsupported release asset: ${filename}`)
    const [, platform, cpu, extension] = match
    const target = platform === "macos" ? "darwin" : "windows"
    const arch = `${target}-${cpu === "arm64" || cpu === "aarch64" ? "aarch64" : "x86_64"}`
    const format = extension === ".app.tar.gz" ? "tar.gz" : extension === "-setup.exe" ? "nsis" : extension.slice(1)
    if ((target === "darwin") !== ["dmg", "tar.gz"].includes(format)) {
      throw new Error(`Invalid platform/format: ${filename}`)
    }
    const stat = lstatSync(join(directory, filename))
    if (!stat.isFile() || stat.size === 0) throw new Error(`Release asset is not a nonempty file: ${filename}`)
    // A signature marks an updater package in the admin API. DMGs are installers only.
    const signature = format === "dmg" ? "" : readFileSync(join(directory, `${filename}.sig`), "utf8").trim()
    if (format !== "dmg" && !signature) throw new Error(`Missing updater signature: ${filename}`)
    artifacts.push({
      download_url: `https://static.alwith.ai/alwith-u/release/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`,
      target,
      arch,
      format,
      label:
        target === "darwin"
          ? arch.endsWith("aarch64")
            ? "Apple Silicon"
            : "Intel"
          : arch.endsWith("aarch64")
            ? "ARM64"
            : "64-bit",
      signature_text: signature
    })
  }
  for (const [arch, format] of [
    ["darwin-aarch64", "tar.gz"],
    ["windows-x86_64", "nsis"],
    ["windows-aarch64", "nsis"]
  ]) {
    if (!artifacts.some(artifact => artifact.arch === arch && artifact.format === format)) {
      throw new Error(`Missing updater artifact: ${arch}/${format}`)
    }
  }
  return artifacts
}

export async function registerRelease(
  directory: string,
  tag: string,
  apiBase: string,
  token: string,
  request: typeof fetch = fetch
): Promise<number> {
  if (!token) throw new Error("Missing CI_RELEASE_TOKEN")
  const base = new URL(apiBase)
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("API_BASE must be an HTTPS management base URL")
  }
  const path = base.pathname.replace(/\/$/, "")
  if (path !== "" && path !== "/management") throw new Error("API_BASE must end at /management or the host")
  const endpoint = `${base.origin}/management/ci/open-source/releases/alwith-u/${encodeURIComponent(releaseVersion(tag))}/artifacts/by-url`
  // Validate every artifact and signature before making any remote changes.
  const artifacts = releaseArtifacts(directory, tag)
  for (const artifact of artifacts) {
    const response = await request(endpoint, {
      method: "POST",
      headers: { "X-CI-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(artifact),
      signal: AbortSignal.timeout(300_000),
      redirect: "error"
    })
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Artifact registration failed: ${artifact.arch}/${artifact.format}, HTTP ${response.status}`)
    }
    await response.arrayBuffer()
  }
  return artifacts.length
}
