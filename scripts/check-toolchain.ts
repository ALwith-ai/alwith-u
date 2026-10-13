import manifest from "../package.json"
import { toolchainVersions } from "./lib/toolchain"

// Checks that the pins agree with each other (bundled Bun and Codex across their platform packages);
// the Bun installed on this machine is not part of it.
const versions = toolchainVersions(manifest)
console.log(`Toolchain pins: build Bun ${versions.buildBun}, bundled Bun ${versions.bun}, Codex ${versions.codex}`)
