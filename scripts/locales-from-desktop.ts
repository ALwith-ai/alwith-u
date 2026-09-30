#!/usr/bin/env bun
/**
 * Builds src/locales/<lang>.json from ALwith Desktop's translations without translating
 * anything ourselves: a key is translated when its English value appears verbatim in one
 * of Desktop's en namespaces and that namespace has the same key in the target language.
 * Only translated keys are written; i18next falls back to English for the rest.
 *
 * Usage: bun scripts/locales-from-desktop.ts [path-to-alwith-desktop]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const desktop = resolve(process.argv[2] ?? join(root, "../alwith-desktop"))
const desktopLocales = join(desktop, "src/locales")
if (!existsSync(desktopLocales)) throw new Error(`ALwith Desktop locales not found at ${desktopLocales}`)

/** Languages Desktop ships; zh-CN is ours and only gets gaps filled. */
const LANGUAGES = ["ar", "de", "es", "fr", "hi", "id", "it", "ja", "ko", "pt-BR", "ru", "zh-CN"] as const

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`
    if (typeof value === "string") out.set(path, value)
    else for (const [inner, text] of flatten(value, path)) out.set(inner, text)
  }
  return out
}

function nest(entries: Map<string, string>, order: Map<string, string>): Tree {
  const tree: Tree = {}
  // Keep en.json's key order so diffs stay readable.
  for (const key of order.keys()) {
    const value = entries.get(key)
    if (value === undefined) continue
    const parts = key.split(".")
    let node = tree
    for (const part of parts.slice(0, -1)) {
      const next = node[part]
      if (typeof next === "string") throw new Error(`Key ${key} collides with a string at ${part}`)
      node = next ?? (node[part] = {})
    }
    node[parts[parts.length - 1]!] = value
  }
  return tree
}

function readJson(path: string): Tree {
  return JSON.parse(readFileSync(path, "utf8")) as Tree
}

function placeholders(text: string): string {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map(match => match[1])
    .sort()
    .join(",")
}

const ours = flatten(readJson(join(root, "src/locales/en.json")))

// English value → [namespace, key] in Desktop. The first namespace seen wins for a value.
const desktopEn = new Map<string, { namespace: string; key: string }>()
for (const file of readdirSync(join(desktopLocales, "en"))
  .filter(name => name.endsWith(".json"))
  .sort()) {
  const namespace = file.slice(0, -".json".length)
  for (const [key, value] of flatten(readJson(join(desktopLocales, "en", file)))) {
    if (!desktopEn.has(value)) desktopEn.set(value, { namespace, key })
  }
}

const skipped: string[] = []
const rows: string[] = []
for (const language of LANGUAGES) {
  const languageDir = join(desktopLocales, language)
  if (!existsSync(languageDir)) throw new Error(`Desktop has no ${language} locale at ${languageDir}`)
  const namespaces = new Map<string, Map<string, string>>()
  const translated = new Map<string, string>()
  const target = join(root, "src/locales", `${language}.json`)
  const existing = language === "zh-CN" && existsSync(target) ? flatten(readJson(target)) : new Map<string, string>()
  for (const [key, english] of ours) {
    const current = existing.get(key)
    if (current !== undefined && current !== english) {
      translated.set(key, current)
      continue
    }
    const source = desktopEn.get(english)
    if (source === undefined) continue
    let namespace = namespaces.get(source.namespace)
    if (namespace === undefined) {
      const path = join(languageDir, `${source.namespace}.json`)
      namespace = existsSync(path) ? flatten(readJson(path)) : new Map<string, string>()
      namespaces.set(source.namespace, namespace)
    }
    const text = namespace.get(source.key)
    if (text === undefined || text === english) continue
    if (placeholders(text) !== placeholders(english)) {
      skipped.push(`${language} ${key}: "${english}" → "${text}" (${source.namespace}:${source.key})`)
      continue
    }
    translated.set(key, text)
  }
  writeFileSync(target, `${JSON.stringify(nest(translated, ours), null, 2)}\n`)
  rows.push(`${language.padEnd(6)} ${String(translated.size).padStart(4)} / ${ours.size}`)
}

console.log("Coverage (translated / keys):")
for (const row of rows) console.log(`  ${row}`)
if (skipped.length > 0) {
  console.log(`Skipped (placeholder mismatch): ${skipped.length}`)
  for (const line of skipped) console.log(`  ${line}`)
}
