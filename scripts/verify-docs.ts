// No login or model inference: verify the catalog in an isolated Codex home.
import { startTestRuntime } from "@alwith/api/node"
import { CodexClient } from "@alwith/module-chat/client"

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
