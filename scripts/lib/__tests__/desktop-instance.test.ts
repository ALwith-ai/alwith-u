import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { instanceWorkspace } from "../desktop-instance"

test("additional instances retain independent source and dependency snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "u-instance-"))
  try {
    const source = join(root, "source")
    const instances = join(root, "instances")
    for (const directory of ["node_modules/package", ".git", "src-tauri/target", "src-tauri/target-dev1"]) {
      await mkdir(join(source, directory), { recursive: true })
      await writeFile(join(source, directory, "fixture"), "original")
    }
    await writeFile(join(source, "app.ts"), "original")
    expect(await instanceWorkspace(source, 1, instances)).toBe(source)
    const second = await instanceWorkspace(source, 2, instances)
    await writeFile(join(source, "app.ts"), "changed source")
    await writeFile(join(source, "node_modules/package/fixture"), "changed dependency")
    expect(await readFile(join(second, "app.ts"), "utf8")).toBe("original")
    expect(await readFile(join(second, "node_modules/package/fixture"), "utf8")).toBe("original")
    for (const excluded of [".git", "src-tauri/target", "src-tauri/target-dev1"]) {
      expect(await Bun.file(join(second, excluded, "fixture")).exists()).toBe(false)
    }
    await writeFile(join(second, "app.ts"), "instance edit")
    expect(await instanceWorkspace(source, 2, instances)).toBe(second)
    expect(await readFile(join(second, "app.ts"), "utf8")).toBe("instance edit")
    expect(await instanceWorkspace(second, 2, instances)).toBe(second)
    await expect(instanceWorkspace(second, 3, instances)).rejects.toThrow("belongs to Dev2")
    await mkdir(join(instances, "dev3"))
    await expect(instanceWorkspace(source, 3, instances)).rejects.toThrow("without its identity")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
