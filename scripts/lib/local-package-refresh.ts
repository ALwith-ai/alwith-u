import path from "node:path"

import type { Plugin } from "vite"

/** Installed package files are ignored by Vite's watcher; local patches must invalidate their cached imports. */
export function localPackageRefresh(): Plugin {
  return {
    name: "local-package-refresh",
    apply: "serve",
    configureServer(server) {
      const directory = path.resolve(server.config.root, "patches") + path.sep
      let timer: ReturnType<typeof setTimeout> | undefined
      const changed = (file: string) => {
        const absolute = path.resolve(file)
        if (!absolute.startsWith(directory) || !absolute.endsWith(".patch")) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          void server.restart().catch((error: unknown) => server.config.logger.error(String(error)))
        }, 300)
      }
      server.watcher.add(directory)
      server.watcher.on("add", changed).on("change", changed).on("unlink", changed)
      server.httpServer?.once("close", () => {
        clearTimeout(timer)
        server.watcher.off("add", changed).off("change", changed).off("unlink", changed)
      })
    }
  }
}
