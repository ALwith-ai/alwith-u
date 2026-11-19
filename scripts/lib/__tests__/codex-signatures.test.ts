import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { codexSidecars } from "@alwith/module-chat/stage"

import { verifyCodexArtifacts } from "../codex-signatures"

function fixture(windows = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-signatures-")))
  const triple = windows ? "x86_64-pc-windows-msvc" : "aarch64-apple-darwin"
  const platform = windows ? "win32-x64" : "darwin-arm64"
  const pkg = join(root, `node_modules/@openai/codex/node_modules/@openai/codex-${platform}`)
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, "package.json"), "{}")
  const destination = join(root, "bundle")
  const files = codexSidecars(triple).map((name) => {
    const filename = `${name}${windows ? ".exe" : ""}`
    const source = join(
      pkg,
      "vendor",
      triple,
      name.startsWith("codex-windows") || name === "codex-command-runner" ? "codex-resources" : "bin",
      filename
    )
    const copy = join(destination, filename)
    const staged = join(root, "src-tauri/binaries", `${name}-${triple}${windows ? ".exe" : ""}`)
    for (const path of [source, copy, staged]) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `official ${name}`)
    }
    return { name, source, copy, staged }
  })
  const calls: string[][] = []
  const run = (args: string[]) => {
    calls.push(args)
    return { status: 0, stderr: args[0] === "-dv" ? "TeamIdentifier=VENDOR\n" : "" }
  }
  return {
    root,
    triple,
    destination,
    files,
    artifact: { exe: windows ? ".exe" : "", files },
    calls,
    run,
    [Symbol.dispose]: () => rmSync(root, { recursive: true, force: true })
  }
}

test("staging and packaged Codex preserve verified vendor identity", () => {
  using f = fixture()
  verifyCodexArtifacts(f.root, f.triple, undefined, f.run, f.artifact)
  verifyCodexArtifacts(f.root, f.triple, f.destination, f.run, f.artifact)
  expect(f.calls).toContainEqual(["--verify", "--strict", f.files[0].source])
  expect(f.calls).toContainEqual(["--verify", "--strict", f.files[1].copy])
})

test("a bundle re-signed with another valid identity fails byte preservation", () => {
  using f = fixture()
  writeFileSync(f.files[0].copy, "valid application signature replacing vendor signature")
  expect(() => verifyCodexArtifacts(f.root, f.triple, f.destination, f.run, f.artifact)).toThrow("vendor bytes changed")
})

test("an invalid original signature fails even when every copy matches", () => {
  using f = fixture()
  expect(() =>
    verifyCodexArtifacts(
      f.root,
      f.triple,
      f.destination,
      () => ({ status: 1, stderr: "invalid signature" }),
      f.artifact
    )
  ).toThrow("invalid Codex vendor signature")
})

test("missing or ad-hoc vendor identities cannot pass the check", () => {
  using f = fixture()
  for (const stderr of ["", "TeamIdentifier=not set\n"]) {
    expect(() =>
      verifyCodexArtifacts(f.root, f.triple, f.destination, () => ({ status: 0, stderr }), f.artifact)
    ).toThrow("TeamIdentifier is missing")
  }
})

test("a code signing process failure is propagated", () => {
  using f = fixture()
  const failure = new Error("security service unavailable")
  expect(() =>
    verifyCodexArtifacts(
      f.root,
      f.triple,
      f.destination,
      () => ({ status: null, stderr: "", error: failure }),
      f.artifact
    )
  ).toThrow(failure)
})

test("Windows checks all vendor helpers without invoking macOS signature tools", () => {
  using f = fixture(true)
  verifyCodexArtifacts(f.root, f.triple, f.destination, f.run, f.artifact)
  expect(f.calls).toEqual([])
  writeFileSync(f.files[3].copy, "modified sandbox helper")
  expect(() => verifyCodexArtifacts(f.root, f.triple, f.destination, f.run, f.artifact)).toThrow("vendor bytes changed")
})
