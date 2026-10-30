import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import manifest from "../../../package.json"

test("the frozen lockfile includes every native module platform artifact", () => {
  const lock = readFileSync(join(import.meta.dir, "../../../bun.lock"), "utf8")
  for (const name of Object.keys(manifest.devDependencies)) {
    if (!name.startsWith("@alwith/native-") || name === "@alwith/native-kit") continue
    const directory = dirname(fileURLToPath(import.meta.resolve(`${name}/stage`)))
    const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      optionalDependencies: Record<string, string>
    }
    for (const [platform, version] of Object.entries(metadata.optionalDependencies)) {
      expect(lock, `${name} requires ${platform}@${version} in frozen CI installs`).toContain(
        `"${platform}": ["${platform}@${version}"`
      )
    }
  }
})
