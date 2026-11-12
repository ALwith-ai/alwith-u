import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { parseGuide } from "../../src/core/docs"

export async function stageDocs(root: string, destination = join(root, "src-tauri/resources/adapter/alwith-docs")) {
  const content = readFileSync(join(root, "guide/index.md"), "utf8")
  const metadata = JSON.parse(readFileSync(join(root, "guide/catalog.json"), "utf8"))
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const chapters = parseGuide(content, metadata)
  mkdirSync(join(destination, "agents"), { recursive: true })
  mkdirSync(join(destination, "references"), { recursive: true })
  // Remove obsolete standalone-server artifacts when upgrading an existing staging directory.
  for (const file of ["server.mjs", "THIRD_PARTY_NOTICES.txt"]) rmSync(join(destination, file), { force: true })
  for (const file of ["SKILL.md", "agents/openai.yaml"]) {
    copyFileSync(join(root, "skills/alwith-docs", file), join(destination, file))
  }
  writeFileSync(
    join(destination, "references/manual.md"),
    `# ALwith U ${version}\n\n` +
      chapters
        .map((chapter) => `## ${chapter.title}\n\nSource: [${chapter.title}](${chapter.url})\n\n${chapter.text}\n`)
        .join("\n")
  )
}
