import { createHash, randomUUID } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const files = ["SKILL.md", "agents/openai.yaml", "references/manual.md"]
const marker = ".alwith-docs.json"
const hash = (text: string) => createHash("sha256").update(text).digest("hex")

/** Stable Codex skill paths preserve the user's enablement choice across app upgrades. */
export function installDocsSkill(source: string, codexHome: string): "installed" | "preserved" {
  const target = join(codexHome, "skills", "alwith-docs")
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink() || !existsSync(join(target, marker))) return "preserved"
    const saved = JSON.parse(readFileSync(join(target, marker), "utf8")) as {
      owner?: string
      hashes?: Record<string, string>
    }
    if (saved.owner !== "alwith-u" || !saved.hashes) return "preserved"
    for (const file of files) {
      const path = join(target, file)
      if (
        !existsSync(path) ||
        lstatSync(path).isSymbolicLink() ||
        hash(readFileSync(path, "utf8")) !== saved.hashes[file]
      )
        return "preserved"
    }
    for (const directory of ["agents", "references"])
      if (lstatSync(join(target, directory)).isSymbolicLink()) return "preserved"
  }
  const contents = files.map((file) => ({ file, text: readFileSync(join(source, file), "utf8") }))
  const hashes: Record<string, string> = {}
  for (const { file, text } of contents) {
    const path = join(target, file)
    hashes[file] = hash(text)
    if (existsSync(path) && readFileSync(path, "utf8") === text) continue
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, text)
    renameSync(temporary, path)
  }
  const temporary = join(target, `${marker}.${randomUUID()}.tmp`)
  writeFileSync(temporary, JSON.stringify({ owner: "alwith-u", hashes }))
  renameSync(temporary, join(target, marker))
  return "installed"
}
