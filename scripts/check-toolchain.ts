import manifest from "../package.json"
import { assertVersion, toolchainVersions } from "./lib/toolchain"

const versions = toolchainVersions(manifest)
assertVersion("build Bun", Bun.version, versions.buildBun)
console.log(`Toolchain pins: build Bun ${versions.buildBun}, bundled Bun ${versions.bun}, Codex ${versions.codex}`)
