import { createStoreClient } from "@alwith/module-store"
import { createTauriStorePort } from "@alwith/module-store/tauri"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

const port = createTauriStorePort({ invoke, listen })
export const { openStore } = createStoreClient(() => port)
