import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import type { Plugin } from "vite"

/** Patched dependencies are outside Vite's watched module graph. */
export function dependencyPatchReload(root = path.resolve(import.meta.dirname, "../..")): Plugin {
  const directory = path.resolve(root, "patches")
  const hash = createHash("sha256")
  if (existsSync(directory)) {
    for (const file of readdirSync(directory)
      .filter((file) => file.endsWith(".patch"))
      .sort()) {
      hash
        .update(file)
        .update("\0")
        .update(readFileSync(path.join(directory, file)))
        .update("\0")
    }
  }
  return {
    // Vite includes plugin names in its dependency/browser hash. A package version
    // alone cannot invalidate immutable URLs when local patches replace its chunks.
    name: `dependency-patch-reload:${hash.digest("hex").slice(0, 16)}`,
    apply: "serve",
    configureServer(server) {
      const changed = (file: string) => {
        // A patch can replace transitive chunks without changing the package version.
        if (file.startsWith(`${directory}${path.sep}`) && file.endsWith(".patch")) void server.restart(true)
      }
      server.watcher.add(directory)
      server.watcher.on("change", changed)
      server.watcher.on("add", changed)
      server.watcher.on("unlink", changed)
      server.httpServer?.once("close", () => {
        server.watcher.off("change", changed)
        server.watcher.off("add", changed)
        server.watcher.off("unlink", changed)
      })
    }
  }
}
