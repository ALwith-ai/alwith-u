// Keep browser lifetimes bounded: the catalog imports full desktop surfaces and media.
// Every generated story is tested; each batch gets a fresh Vitest/Chromium process.
const filters = process.argv.slice(2)
const files = [...new Bun.Glob(".storybook/stories/{page-boards,flows}/**/*.stories.tsx").scanSync(".")]
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort()
if (files.length === 0) throw new Error("No Storybook files matched the requested filters")
const base = "http://127.0.0.1:6007"
const ready = async () => {
  try {
    const response = await fetch(`${base}/index.json`, { signal: AbortSignal.timeout(1000) })
    return response.ok && typeof (await response.json()).entries === "object"
  } catch {
    return false
  }
}
let preview: ReturnType<typeof Bun.spawn> | undefined
let failed = false
try {
  if (!(await ready())) {
    if (!(await Bun.file("storybook-static/index.json").exists()))
      throw new Error("Build Storybook before running browser tests: bun run storybook:build")
    preview = Bun.spawn(
      [
        process.execPath,
        "x",
        "--no-install",
        "vite",
        "preview",
        "--config",
        ".storybook/vite.config.ts",
        "--outDir",
        "storybook-static",
        "--host",
        "127.0.0.1",
        "--port",
        "6007",
        "--strictPort"
      ],
      { stdout: "inherit", stderr: "inherit" }
    )
    const deadline = Date.now() + 30_000
    while (!(await ready())) {
      if (preview.exitCode !== null) throw new Error(`Storybook preview exited with ${preview.exitCode}`)
      if (Date.now() >= deadline) throw new Error("Storybook preview did not become ready")
      await Bun.sleep(250)
    }
  }
  const batchSize = 8
  for (let offset = 0; offset < files.length; offset += batchSize) {
    const batch = files.slice(offset, offset + batchSize)
    console.log(
      `Storybook batch ${Math.floor(offset / batchSize) + 1}/${Math.ceil(files.length / batchSize)}: ${batch.join(", ")}`
    )
    const child = Bun.spawn(
      [process.execPath, "x", "--no-install", "vitest", "run", "--config", ".storybook/vitest.config.ts", ...batch],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" }
    )
    if ((await child.exited) !== 0) failed = true
  }
  if (!failed) {
    const diagrams = Bun.spawn([process.execPath, ".storybook/verify-player.mjs"], {
      env: { ...process.env, STORYBOOK_URL: base },
      stdout: "inherit",
      stderr: "inherit"
    })
    if ((await diagrams.exited) !== 0) failed = true
  }
} finally {
  if (preview) {
    preview.kill()
    await preview.exited
  }
}
process.exitCode = failed ? 1 : 0
export {}
