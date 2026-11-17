import { constants } from "node:fs"
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join, relative, resolve } from "node:path"

export function instanceName(instance: number) {
  if (!Number.isInteger(instance) || instance < 1 || instance > 9)
    throw Error("Instance must be an integer from 1 to 9")
  return `Dev${instance}`
}

export function instanceArguments(args: string[]) {
  const rest: string[] = []
  let instance: number | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === "--instance" || arg.startsWith("--instance=")) {
      if (instance !== undefined) throw Error("Specify --instance once")
      const value = arg === "--instance" ? args[++index] : arg.slice(11)
      if (!value || !/^[1-9]$/.test(value)) throw Error("Instance must be an integer from 1 to 9")
      instance = Number(value)
    } else rest.push(arg)
  }
  return { instance, rest }
}

export function instanceConfig(instance: number) {
  const name = instanceName(instance)
  return {
    identifier: `ai.alwith.u.dev${instance}`,
    productName: `ALwith U ${name}`,
    build: { devUrl: `http://127.0.0.1:${1400 + instance}` }
  }
}

/** A persistent source snapshot, including its own installed dependencies and staging resources. */
export async function instanceWorkspace(
  source: string,
  instance: number,
  root = join(homedir(), ".cache/alwith-u/instances")
) {
  instanceName(instance)
  source = resolve(source)
  const marker = ".alwith-dev-instance.json"
  const readInstance = async (directory: string): Promise<number | undefined> => {
    try {
      const value: unknown = JSON.parse(await readFile(join(directory, marker), "utf8"))
      if (
        !value ||
        typeof value !== "object" ||
        !("instance" in value) ||
        typeof value.instance !== "number" ||
        !Number.isInteger(value.instance) ||
        value.instance < 1 ||
        value.instance > 9
      )
        throw Error(`Invalid instance identity: ${directory}`)
      return value.instance
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }
  const bound = await readInstance(source)
  if (bound !== undefined) {
    if (bound !== instance)
      throw Error(`This workspace belongs to ${instanceName(bound)}; use its original checkout for another instance`)
    return source
  }
  if (instance === 1) return source
  const destination = join(root, `dev${instance}`)
  if ((await readInstance(destination)) === instance) return destination
  try {
    await stat(destination)
    throw Error(`Instance directory already exists without its identity: ${destination}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  await mkdir(root, { recursive: true })
  const staging = `${destination}.staging-${process.pid}`
  try {
    await cp(source, staging, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
      filter(path) {
        const entry = relative(source, path).replaceAll("\\", "/")
        return (
          ![".git", "dist", "storybook-static", "src-tauri/target"].includes(entry) &&
          !(entry.startsWith("src-tauri/") && /^target-dev\d+$/.test(basename(path)))
        )
      }
    })
    await writeFile(join(staging, marker), JSON.stringify({ instance, source }) + "\n")
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return destination
}
