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

/** Per-process MCP configuration, never a write to the user's config.toml. */
export function docsSessionConfig(source: string, command: string, server: string): string {
  const config = JSON.parse(source) as Record<string, unknown>
  const servers = config.mcp_servers
  if (servers !== undefined && (typeof servers !== "object" || servers === null || Array.isArray(servers)))
    throw new Error("Invalid MCP server configuration")
  if (servers && "alwith_docs" in servers) throw new Error("The alwith_docs server name is reserved by ALwith U")
  return JSON.stringify({
    ...config,
    mcp_servers: {
      ...servers,
      alwith_docs: { command, args: ["--no-install", server] }
    }
  })
}
