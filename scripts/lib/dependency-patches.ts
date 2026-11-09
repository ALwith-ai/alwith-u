import path from "node:path"

import type { Plugin } from "vite"

/** Patched dependencies are outside Vite's watched module graph. */
export function dependencyPatchReload(): Plugin {
  return {
    name: "dependency-patch-reload",
    apply: "serve",
    configureServer(server) {
      const directory = path.resolve(server.config.root, "patches")
      const changed = (file: string) => {
        if (file.startsWith(`${directory}${path.sep}`) && file.endsWith(".patch")) void server.restart()
      }
      server.watcher.add(directory)
      server.watcher.on("change", changed)
      server.httpServer?.once("close", () => server.watcher.off("change", changed))
    }
  }
}
