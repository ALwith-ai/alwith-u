interface ImportPackage {
  path: string
  id: string
  version: string
  digest: string
  source: string
}

export interface StartupImportPort {
  scan(): Promise<{ tasks: string[]; errors: string[] }>
  prepare(id: string): Promise<{ id: string; phase: "prepared" | "committed"; package: ImportPackage | null }>
  install(pkg: ImportPackage): Promise<void>
  complete(id: string): Promise<void>
  failed(id: string, message: string): Promise<void>
  report(message: string): void
}

/** A failed package must not prevent independent packages from being processed. */
export async function runStartupImports(port: StartupImportPort): Promise<void> {
  const scanned = await port.scan()
  for (const error of scanned.errors) port.report(error)
  for (const id of scanned.tasks) {
    try {
      const task = await port.prepare(id)
      if (task.phase === "prepared") {
        if (!task.package) throw new Error("Prepared import has no package")
        await port.install(task.package)
      }
      await port.complete(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        await port.failed(id, message)
        port.report(message)
      } catch (failure) {
        port.report(`${message}; could not save import failure: ${String(failure)}`)
      }
    }
  }
}
