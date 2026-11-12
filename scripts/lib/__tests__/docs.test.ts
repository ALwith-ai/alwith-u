import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import metadata from "../../../guide/catalog.json"
import { parseGuide, searchGuide } from "../../../src/core/docs"
import { stageDocs } from "../docs-artifact"
import { installDocsSkill } from "../docs-install"

const chapters = parseGuide(readFileSync(join(import.meta.dirname, "../../../guide/index.md"), "utf8"), metadata)
const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "alwith-docs-"))
  temporary.push(home)
  const source = join(home, "source")
  mkdirSync(join(source, "agents"), { recursive: true })
  mkdirSync(join(source, "references"))
  writeFileSync(join(source, "SKILL.md"), "skill v1")
  writeFileSync(join(source, "agents/openai.yaml"), "metadata")
  writeFileSync(join(source, "references/manual.md"), "manual v1")
  return { home, source, installed: join(home, "skills/alwith-docs") }
}

test("search handles English and natural Chinese questions, and returns no invented match", () => {
  expect(searchGuide(chapters, "provider model")[0].id).toBe("models")
  expect(searchGuide(chapters, "怎么配置模型供应商")[0].id).toBe("models")
  expect(searchGuide(chapters, "技能怎么启用")[0].id).toBe("plugins")
  expect(searchGuide(chapters, "zznonexistenttopic")).toEqual([])
  expect(() => parseGuide("# empty", metadata)).toThrow()
  expect(() => searchGuide(chapters, "  ")).toThrow()
})

test("managed skill upgrades keep its path and preserve subsequent user edits", () => {
  const { home, source, installed } = fixture()
  expect(installDocsSkill(source, home)).toBe("installed")
  writeFileSync(join(source, "references/manual.md"), "manual v2")
  expect(installDocsSkill(source, home)).toBe("installed")
  expect(readFileSync(join(installed, "references/manual.md"), "utf8")).toBe("manual v2")
  writeFileSync(join(installed, "SKILL.md"), "user's custom instructions")
  expect(installDocsSkill(source, home)).toBe("preserved")
  expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("user's custom instructions")
})

test("existing user skills are never claimed by the installer", () => {
  const { home, source, installed } = fixture()
  mkdirSync(installed, { recursive: true })
  writeFileSync(join(installed, "SKILL.md"), "user skill")
  expect(installDocsSkill(source, home)).toBe("preserved")
  expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("user skill")
})

test("staging replaces standalone-server artifacts with the skill and shared manual", async () => {
  const { source } = fixture()
  writeFileSync(join(source, "server.mjs"), "obsolete server")
  writeFileSync(join(source, "THIRD_PARTY_NOTICES.txt"), "obsolete server licenses")
  await stageDocs(join(import.meta.dirname, "../../.."), source)
  expect(existsSync(join(source, "server.mjs"))).toBe(false)
  expect(existsSync(join(source, "THIRD_PARTY_NOTICES.txt"))).toBe(false)
  const manual = readFileSync(join(source, "references/manual.md"), "utf8")
  for (const chapter of chapters) {
    expect(manual).toContain(chapter.text)
    expect(manual).toContain(chapter.url)
  }
})

test("new workflows are searchable and every chapter citation resolves", () => {
  for (const [query, id] of [
    ["图片生成", "images"],
    ["语音听写", "voice"],
    ["电脑重连", "computer"],
    ["手机配对", "mobile"],
    ["导入历史", "import"],
    ["会话收藏", "sessions"],
    ["叫回休息室", "vibemon"],
    ["云盘分享", "cloud-vibemon"],
    ["诊断导出", "troubleshooting"]
  ])
    expect(searchGuide(chapters, query)[0]?.id).toBe(id)
  const urls = new Set(chapters.map((chapter) => chapter.url))
  for (const chapter of chapters)
    for (const link of chapter.text.matchAll(/alwith-docs:\/\/guide\/[a-z-]+/g)) expect(urls.has(link[0])).toBe(true)
})
