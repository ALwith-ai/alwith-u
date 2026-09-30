import manifest from "../package.json"
import { assertVersion, toolchainVersions } from "./lib/toolchain"

const versions = toolchainVersions(manifest)
assertVersion("build Bun", Bun.version, versions.bun)
console.log(`Toolchain pins: Bun ${versions.bun}, Codex ${versions.codex}`)
