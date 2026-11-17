import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"

test.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "release staging signs every native library with the application identity and a secure timestamp",
  () => {
    const root = resolve(import.meta.dirname, "../../..")
    const temporary = mkdtempSync(join(tmpdir(), "alwith-native-signing-"))
    const bin = join(temporary, "bin")
    const log = join(temporary, "codesign.jsonl")
    const recorder = join(temporary, "record.ts")
    const identity = "ALwith test signing identity"
    try {
      mkdirSync(bin)
      writeFileSync(
        recorder,
        'import { appendFileSync } from "node:fs"; appendFileSync(process.env.ALWITH_TEST_CODESIGN_LOG!, JSON.stringify(process.argv.slice(2)) + "\\n")\n'
      )
      const codesign = join(bin, "codesign")
      writeFileSync(codesign, '#!/bin/sh\nexec "$ALWITH_TEST_BUN" "$ALWITH_TEST_CODESIGN_RECORDER" "$@"\n')
      chmodSync(codesign, 0o755)
      const result = Bun.spawnSync([process.execPath, "scripts/stage.ts", "aarch64-apple-darwin"], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          APPLE_SIGNING_IDENTITY: identity,
          ALWITH_TEST_BUN: process.execPath,
          ALWITH_TEST_CODESIGN_RECORDER: recorder,
          ALWITH_TEST_CODESIGN_LOG: log
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 45_000
      })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[])
      const native = join(root, "src-tauri/resources/native")
      const libraries = readdirSync(native).filter((name) => name.endsWith(".dylib"))
      expect(libraries).toContain("libalwith_native_terminal.dylib")
      for (const library of libraries)
        expect(calls, library).toContainEqual([
          "--force",
          "--timestamp",
          "--options",
          "runtime",
          "--sign",
          identity,
          join(native, library)
        ])
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  },
  60_000
)
