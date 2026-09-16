#!/usr/bin/env bun
/**
 * Aligns existing translations with the official Codex/ChatGPT desktop app's wording. This
 * is terminology alignment, not copying: a key changes only when our English source is the
 * same string as an official message AND we already carry a translation that differs.
 * Missing keys stay missing (i18next falls back to English); en.json is never touched.
 *
 * Usage: bun scripts/locales-align-official.ts <official-en.json> <official-locales.json>
 *   official-en.json      { officialKey: englishDefaultMessage }
 *   official-locales.json { lang: { officialKey: translation } }
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const [enPath, localesPath] = process.argv.slice(2)
if (!enPath || !localesPath)
  throw new Error("Usage: locales-align-official.ts <official-en.json> <official-locales.json>")

type Tree = { [key: string]: string | Tree }

/**
 * zh-CN keys kept as ours: the official strings are mistranslations (real-estate "listing",
 * "foreground" as an image layer) or drop the completed aspect our tool verbs carry.
 */
const ZH_CN_KEEP = new Set([
  "chat.tool.listing",
  "chat.tool.listed",
  "actions.foreground",
  "actions.background",
  "chat.tool.ran",
  "chat.tool.searched",
  "chat.tool.read"
])

/**
 * Keys whose English is a generic word the official app translates per screen ("Output" as
 * tokens vs. a tool's output, "About" as a plugin's About); the official majority is another
 * context, so these keep ours in every language.
 */
const CONTEXT_LOCKED = new Set(["chat.tool.output", "chat.tool.input", "settings.about"])

const LANGUAGES = ["zh-CN", "ja", "ko", "de", "fr", "es", "pt-BR", "ru", "it", "id", "hi", "ar"] as const

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`
    if (typeof value === "string") out.set(path, value)
    else for (const [inner, text] of flatten(value, path)) out.set(inner, text)
  }
  return out
}

function setPath(tree: Tree, path: string, value: string): void {
  const parts = path.split(".")
  let node = tree
  for (const part of parts.slice(0, -1)) {
    const next = node[part]
    if (typeof next !== "object" || next === null) throw new Error(`Not an object at ${part} in ${path}`)
    node = next
  }
  node[parts[parts.length - 1]!] = value
}

/** Placeholders (`{{x}}` ours, `{x}` official) become `{}`; punctuation and case are ignored. */
function normalize(text: string): string {
  return text
    .replace(/\{\{?\s*\w+\s*\}?\}/g, "{}")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.…]+$/u, "")
    .toLowerCase()
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{?\s*(\w+)\s*\}?\}/g)].map(match => match[1]!)
}

/** Rewrites the official `{x}` placeholders with our `{{name}}` in source order. */
function adoptPlaceholders(official: string, ours: string): string | null {
  const names = placeholders(ours)
  const officialNames = placeholders(official)
  if (names.length !== officialNames.length) return null
  let index = 0
  return official.replace(/\{\{?\s*\w+\s*\}?\}/g, () => `{{${names[index++]}}}`)
}

const officialEn = JSON.parse(readFileSync(enPath, "utf8")) as Record<string, string>
const officialLocales = JSON.parse(readFileSync(localesPath, "utf8")) as Record<string, Record<string, string>>
const ours = flatten(JSON.parse(readFileSync(join(root, "src/locales/en.json"), "utf8")) as Tree)

const byEnglish = new Map<string, string[]>()
for (const [key, text] of Object.entries(officialEn)) {
  const norm = normalize(text)
  const list = byEnglish.get(norm) ?? []
  list.push(key)
  byEnglish.set(norm, list)
}

for (const lang of LANGUAGES) {
  const official = officialLocales[lang]
  if (!official) throw new Error(`official-locales.json has no ${lang}`)
  const file = join(root, "src/locales", `${lang}.json`)
  const tree = JSON.parse(readFileSync(file, "utf8")) as Tree
  const current = flatten(tree)
  const changed: Array<[string, string, string]> = []
  const skipped: Array<[string, string]> = []
  for (const [key, english] of ours) {
    const mine = current.get(key)
    if (mine === undefined) continue
    if (CONTEXT_LOCKED.has(key)) continue
    if (lang === "zh-CN" && ZH_CN_KEEP.has(key)) continue
    const candidates = (byEnglish.get(normalize(english)) ?? [])
      .map(id => official[id])
      .filter((t): t is string => typeof t === "string")
    if (candidates.length === 0) continue
    if (candidates.some(candidate => normalize(candidate) === normalize(mine))) continue
    // One English string can mean different things in different official screens ("Output"
    // as tokens vs. as a tool's output). When the official translations disagree with each
    // other, the match is ambiguous and ours stays.
    // Untranslated official entries (the English left as is) do not count as candidates.
    const translated = candidates.filter(candidate => normalize(candidate) !== normalize(english))
    if (translated.length === 0) {
      skipped.push([key, "official left in English"])
      continue
    }
    const votes = new Map<string, { text: string; count: number }>()
    for (const candidate of translated) {
      const entry = votes.get(normalize(candidate)) ?? { text: candidate, count: 0 }
      entry.count += 1
      votes.set(normalize(candidate), entry)
    }
    const ranked = [...votes.values()].sort((a, b) => b.count - a.count)
    const winner = ranked[0]!
    // A clear majority (two thirds) settles the wording; otherwise the match is ambiguous.
    if (ranked.length > 1 && winner.count * 3 < translated.length * 2) {
      skipped.push([
        key,
        `ambiguous: ${ranked
          .slice(0, 3)
          .map(entry => `${entry.text}×${entry.count}`)
          .join(" / ")}`
      ])
      continue
    }
    const theirs = winner.text
    if (theirs.trim() === "") {
      skipped.push([key, "empty"])
      continue
    }
    const adopted = adoptPlaceholders(theirs, mine)
    if (adopted === null) {
      skipped.push([key, `placeholder count ${placeholders(theirs).length} vs ${placeholders(mine).length}`])
      continue
    }
    setPath(tree, key, adopted)
    changed.push([key, mine, adopted])
  }
  writeFileSync(file, `${JSON.stringify(tree, null, 2)}\n`)
  console.log(`\n## ${lang}: changed ${changed.length}, skipped ${skipped.length}`)
  for (const [key, from, to] of changed) console.log(`  ${key}: ${from} -> ${to}`)
  for (const [key, why] of skipped) console.log(`  skip ${key}: ${why}`)
}
