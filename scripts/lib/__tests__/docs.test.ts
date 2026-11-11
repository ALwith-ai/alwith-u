import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import metadata from "../../../guide/catalog.json"
import { parseGuide, searchGuide } from "../../../src/core/docs"
import { docsSessionConfig, installDocsSkill } from "../docs-install"
import { createDocsServer } from "../docs-server"

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

test("MCP search, fetch and outline return the same versioned source and reject unknown IDs", async () => {
  const server = createDocsServer(chapters, "1.2.3")
  const client = new Client({ name: "docs-test", version: "1.0.0" })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(b)
  await client.connect(a)
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["search", "fetch", "outline"])
    const result = await client.callTool({ name: "fetch", arguments: { id: "models" } })
    const content = result.content as { text: string }[]
    const fetched = JSON.parse(content[0].text)
    expect(fetched.version).toBe("1.2.3")
    expect(fetched.data.text).toBe(chapters.find((chapter) => chapter.id === "models")!.text)
    expect(fetched.data.url).toBe("alwith-docs://guide/models")
    expect((await client.callTool({ name: "outline" })).isError).not.toBe(true)
    expect((await client.callTool({ name: "search", arguments: { query: "模型" } })).isError).not.toBe(true)
    expect((await client.callTool({ name: "fetch", arguments: { id: "../../private" } })).isError).toBe(true)
  } finally {
    await client.close()
    await server.close()
  }
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

test("MCP configuration is session-local and retains other tools and settings", () => {
  const source = JSON.stringify({ features: { computer_use: false }, mcp_servers: { other: { command: "other" } } })
  const config = JSON.parse(docsSessionConfig(source, "/bundled bun", "/resources/docs/server.mjs"))
  expect(config.features.computer_use).toBe(false)
  expect(config.mcp_servers.other.command).toBe("other")
  expect(config.mcp_servers.alwith_docs.args).toEqual(["--no-install", "/resources/docs/server.mjs"])
  expect(() => docsSessionConfig(JSON.stringify(config), "bun", "docs")).toThrow("reserved")
})
