// The app's one plugins store, bound to the app-wide client.
import { client } from "@/lib/client"
import { createPluginsStore } from "./store"

export const pluginsStore = createPluginsStore(client)
