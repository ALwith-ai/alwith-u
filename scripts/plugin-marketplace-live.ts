// Verify U-owned HTTP catalog reads using an isolated copy of the existing Codex login.
import { homedir } from "node:os"
import { join } from "node:path"

import { startTestRuntime } from "@alwith/api/node"
import { CodexClient } from "@alwith/module-chat/client"
import { chatAdapterArtifact } from "@alwith/module-chat/stage"

import { createPluginCatalogStore } from "../src/features/plugins/catalog-store"
import { createPluginMarketplace } from "../src/features/plugins/marketplace"
import { staged } from "./lib/runtime"

for (const transport of ["stdio", "ws"] as const) {
  await using runtime = await startTestRuntime({
    binary: staged("alwith-runtime"),
    transport,
    engines: {
      codex: { command: process.execPath, args: [chatAdapterArtifact().entry], env: { CODEX_PATH: staged("codex") } }
    },
    authFrom: process.env.CODEX_HOME ?? join(homedir(), ".codex")
  })
  const client = new CodexClient(() => Promise.resolve(runtime.client), {
    agentId: "codex",
    launch: { engine: "codex" }
  })
  const requests: { endpoint: string; bytes: number; limit: string | null }[] = []
  try {
    await client.connect()
    const local = await client.listPlugins({ marketplaceKinds: ["local"], cwds: [runtime.workspace] })
    if (local.marketplaces.some((marketplace) => marketplace.path === null))
      throw new Error("Local read included a remote catalog")
    const marketplace = createPluginMarketplace({
      readAuth: (refresh) => client.readPluginServiceAuth(refresh),
      fetch: async (url, init) => {
        const response = await fetch(url, init)
        const bytes = (await response.clone().arrayBuffer()).byteLength
        requests.push({ endpoint: url.pathname, bytes, limit: url.searchParams.get("limit") })
        if (bytes >= 32 * 1024 * 1024) throw new Error("HTTP page exceeded the former ACP frame budget")
        return response
      }
    })
    const catalog = createPluginCatalogStore(marketplace)
    await catalog.getState().load("", [runtime.workspace])
    if (catalog.getState().error) throw new Error(catalog.getState().error!)
    if (requests.length !== 1) throw new Error("Initial browsing prefetched remote pages")
    const firstCount = catalog.getState().entries.length
    if (catalog.getState().nextCursor) await catalog.getState().loadMore()
    if (catalog.getState().error) throw new Error(catalog.getState().error!)
    const appendedCount = catalog.getState().entries.length
    await catalog.getState().load("pdf", [runtime.workspace])
    if (catalog.getState().error) throw new Error(catalog.getState().error!)
    const searchHasNext = catalog.getState().nextCursor !== null
    if (searchHasNext) await catalog.getState().loadMore()
    if (catalog.getState().error) throw new Error(catalog.getState().error!)
    await client.installedPlugins([runtime.workspace])
    await client.listSkills([runtime.workspace])
    if (client.state.connection !== "ready") throw new Error("Agent disconnected")
    if (requests.some((request) => request.limit !== "50")) throw new Error("A remote request omitted its page bound")
    console.log(
      JSON.stringify({
        transport,
        localCount: local.marketplaces.length,
        firstCount,
        appendedCount,
        searchHasNext,
        requests,
        connection: client.state.connection
      })
    )
  } finally {
    client.disconnect()
  }
}
