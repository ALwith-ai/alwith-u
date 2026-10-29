import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { stageWorkBuddy } from "../workbuddy-artifact"

test("the bundled generator works offline without source packages and preserves existing output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workbuddy 生成 "))
  try {
    const resources = join(directory, "resources")
    await stageWorkBuddy(resolve(import.meta.dir, "../../.."), resources)
    const destination = join(directory, "my-buddy")
    const args = [
      process.execPath,
      "--no-install",
      join(resources, "create-alwith/src/cli.js"),
      destination,
      "--name",
      "my-buddy",
      "--product-name",
      "My Buddy",
      "--identifier",
      "com.example.mybuddy",
      "--yes",
      "--json"
    ]
    const generated = Bun.spawnSync(args, { cwd: directory, env: { PATH: "", NODE_PATH: "" } })
    expect(generated.exitCode, generated.stderr.toString()).toBe(0)
    expect(JSON.parse(generated.stdout.toString().trim().split("\n").at(-1)!)).toMatchObject({
      type: "result",
      ok: true,
      directory: destination
    })
    const brand = await readFile(join(destination, "alwith.app.json"), "utf8")
    expect(JSON.parse(brand).productName).toBe("My Buddy")
    expect(await Bun.file(join(destination, "bun.lock")).exists()).toBe(true)
    const existing = Bun.spawnSync(args, { cwd: directory, env: { PATH: "", NODE_PATH: "" } })
    expect(existing.exitCode).not.toBe(0)
    expect(existing.stdout.toString()).toContain("DIRECTORY_EXISTS")
    expect(await readFile(join(destination, "alwith.app.json"), "utf8")).toBe(brand)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
