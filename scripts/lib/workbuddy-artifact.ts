import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

/** Bundle the generator with its immutable template and registry, without host node_modules. */
export async function stageWorkBuddy(root: string, resources: string): Promise<void> {
  const source = process.env.CREATE_ALWITH_PATH ?? join(root, "node_modules/create-alwith")
  const destination = join(resources, "create-alwith")
  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"))
  await mkdir(join(destination, "src"), { recursive: true })
  const result = await Bun.build({ entrypoints: [join(source, "src/cli.ts")], target: "bun", format: "esm" })
  if (!result.success) throw new AggregateError(result.logs, "Cannot bundle create-alwith")
  await writeFile(join(destination, "src/cli.js"), await result.outputs[0].text())
  for (const entry of [
    "template",
    ...(manifest.files.includes("locks") ? ["locks"] : []),
    "registry/built",
    "alwith.app.schema.json",
    "LICENSE",
    "LICENSES",
    "THIRD_PARTY_NOTICES.md"
  ]) {
    const target = join(destination, entry)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(source, entry), target, { recursive: true })
  }
  await writeFile(
    join(destination, "package.json"),
    JSON.stringify({ name: manifest.name, version: manifest.version, type: "module" })
  )
}
