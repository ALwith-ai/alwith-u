import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { parseGuide } from "../../src/core/docs"

export async function stageDocs(root: string, destination = join(root, "src-tauri/resources/adapter/alwith-docs")) {
  const content = readFileSync(join(root, "guide/index.md"), "utf8")
  const metadata = JSON.parse(readFileSync(join(root, "guide/catalog.json"), "utf8"))
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const chapters = parseGuide(content, metadata)
  const build = await Bun.build({ entrypoints: [join(root, "scripts/docs-server.ts")], target: "bun", metafile: true })
  if (!build.success) throw new AggregateError(build.logs, "ALwith Docs bundling failed")
  mkdirSync(join(destination, "agents"), { recursive: true })
  mkdirSync(join(destination, "references"), { recursive: true })
  await Bun.write(join(destination, "server.mjs"), build.outputs[0])
  if (!build.metafile) throw new Error("Missing ALwith Docs build metadata")
  const metadataOutput = typeof build.metafile === "string" ? JSON.parse(build.metafile) : build.metafile
  const inputs = Object.keys((metadataOutput as { inputs: Record<string, unknown> }).inputs)
  const packages = new Set<string>()
  for (const input of inputs) {
    if (!input.replaceAll("\\", "/").includes("node_modules/")) continue
    let directory = dirname(resolve(root, input))
    while (
      !existsSync(join(directory, "package.json")) ||
      typeof JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).name !== "string"
    ) {
      const parent = dirname(directory)
      if (parent === directory) throw new Error(`Missing package metadata for ${input}`)
      directory = parent
    }
    packages.add(directory)
  }
  const notices = [...packages].sort().map((directory) => {
    const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
    const licenses = readdirSync(directory, { withFileTypes: true }).filter(
      (entry) => entry.isFile() && /^(license|copying|notice)(\.|$)/i.test(entry.name)
    )
    if (!licenses.length) throw new Error(`Missing bundled license for ${pkg.name}`)
    return (
      `${pkg.name} ${pkg.version}\n\n` +
      licenses.map((entry) => readFileSync(join(directory, entry.name), "utf8")).join("\n")
    )
  })
  writeFileSync(join(destination, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n---\n\n"))
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
