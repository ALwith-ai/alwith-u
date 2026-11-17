// The app owns HTTP marketplace reads; Codex continues to own local plugins and installation.
import { fetch } from "@tauri-apps/plugin-http"

import { client } from "@/lib/client"

import { createPluginMarketplace } from "./marketplace"
import { createPluginsStore } from "./store"

export const pluginMarketplace = createPluginMarketplace({
  readAuth: (refreshToken) => client.readPluginServiceAuth(refreshToken),
  fetch: (input, init) => fetch(input, { ...init, maxRedirections: 0, connectTimeout: 15_000 })
})
export const pluginsStore = createPluginsStore(client, pluginMarketplace)
