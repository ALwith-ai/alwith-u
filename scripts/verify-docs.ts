import { resolve } from "node:path"

// No login or model inference: verify the catalog in an isolated Codex home.
import { startTestRuntime } from "@alwith/api/node"
import { CodexClient } from "@alwith/module-chat/client"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

import manifest from "../package.json"
import { staged, stagedCodexEngine } from "./lib/runtime"

await using runtime = await startTestRuntime({
  binary: staged("alwith-runtime"),
  engines: { codex: stagedCodexEngine() },
  transport: "stdio"
})
const client = new CodexClient(() => Promise.resolve(runtime.client), {
  agentId: "codex",
  launch: { engine: "codex" }
})
try {
  await client.connect()
  const skills = await client.listSkills([runtime.workspace], true)
  const skill = skills.data.flatMap((entry) => entry.skills).find((entry) => entry.name === "alwith-docs")
  if (!skill || !skill.enabled || skill.interface?.displayName !== "ALwith Docs")
    throw new Error("ALwith Docs is missing from the real Codex skill catalog")
  await client.setSkillEnabled({ path: skill.path, enabled: false })
  const disabled = await client.listSkills([runtime.workspace], true)
  if (disabled.data.flatMap((entry) => entry.skills).find((entry) => entry.path === skill.path)?.enabled !== false)
    throw new Error("Codex did not preserve ALwith Docs enablement")
  await client.setSkillEnabled({ path: skill.path, enabled: true })
  console.log("ALwith Docs: real Codex catalog, metadata and enablement verified in an isolated home")
} finally {
  client.disconnect()
}

const docs = new Client({ name: "alwith-docs-verification", version: "1.0.0" })
try {
  await docs.connect(
    new StdioClientTransport({
      command: staged("bun"),
      args: ["--no-install", resolve(import.meta.dirname, "../src-tauri/resources/adapter/alwith-docs/server.mjs")],
      env: { PATH: "", NODE_PATH: "" }
    })
  )
  for (const request of [
    { name: "outline" },
    { name: "search", arguments: { query: "模型供应商" } },
    { name: "fetch", arguments: { id: "models" } }
  ]) {
    const result = await docs.callTool(request)
    if (result.isError) throw new Error(`Bundled documentation tool failed: ${request.name}`)
    const content = result.content as { type: string; text?: string }[]
    if (content[0]?.type !== "text" || !content[0].text) throw new Error("Missing documentation content")
    if (JSON.parse(content[0].text).version !== manifest.version) throw new Error("Staged documentation is outdated")
  }
  console.log("ALwith Docs: bundled search, fetch and outline work without PATH or external dependencies")
} finally {
  await docs.close()
}
