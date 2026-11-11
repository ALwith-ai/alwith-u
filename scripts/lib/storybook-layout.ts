import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export function isLayoutStoryBoard(board: string): boolean {
  const source = /from "(\.\.\/pages\/[^"]+)"/.exec(readFileSync(board, "utf8"))?.[1]
  if (!source) throw new Error(`${board} does not re-export a source page story`)
  const file = Bun.resolveSync(source, dirname(resolve(board)))
  return /^ {2}tags: \[[^\]]*"layout"/m.test(readFileSync(file, "utf8"))
}
