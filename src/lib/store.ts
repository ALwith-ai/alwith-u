import { createStoreClient } from "@alwith/module-store"
import { createTauriStorePort } from "@alwith/module-store/tauri"

const port = createTauriStorePort()
export const { openStore } = createStoreClient(() => port)
