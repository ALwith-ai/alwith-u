#!/usr/bin/env bun
// Codex and its helpers must reach the app with their vendor bytes and signature: staging copies
// them, never re-signs them. Run after `bun run stage`, or with a built .app (macOS) or the
// directory holding the bundled executables (Windows) to check the packaged copies.
import { join, resolve } from "node:path"

import { $ } from "bun"

import { verifyCodexArtifacts } from "./lib/codex-signatures"

const root = resolve(import.meta.dirname, "..")
const triple = (await $`rustc -vV`.text()).match(/^host: (.+)$/m)?.[1]?.trim()
if (triple === undefined) throw new Error(`Unsupported signature verification target: ${triple}`)
const bundle = process.argv[2]
verifyCodexArtifacts(
  root,
  triple,
  bundle ? join(resolve(bundle), triple.endsWith("apple-darwin") ? "Contents/MacOS" : "") : undefined
)
console.log("PASS: Codex and code-mode host keep their vendor bytes, signatures and TeamIdentifier")
