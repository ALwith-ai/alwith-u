/** Project files held in memory, with the version counter the native adapter reports. */
export function memoryFiles(initial: Record<string, string> = {}) {
  const entries = new Map<string, Uint8Array>()
  const directories = new Set<string>()
  const files = {
    set(path: string, text: string) {
      entries.set(path, new TextEncoder().encode(text))
    },
    text: (path: string) => new TextDecoder().decode(entries.get(path)),
    stat: (path: string) =>
      Promise.resolve(
        entries.has(path)
          ? { kind: "file" as const, size: entries.get(path)!.length, version: "" }
          : directories.has(path)
            ? { kind: "directory" as const, size: 0, version: "" }
            : null
      ),
    readFile: (path: string) => Promise.resolve(entries.get(path)!),
    writeFile(path: string, bytes: Uint8Array) {
      entries.set(path, bytes)
      return Promise.resolve()
    },
    createDirectory(path: string) {
      directories.add(path)
      return Promise.resolve()
    }
  }
  for (const [path, text] of Object.entries(initial)) files.set(path, text)
  return files
}
