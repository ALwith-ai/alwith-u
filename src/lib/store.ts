// 命名 KV 存储的前端入口,与 ALwith Desktop `src/lib/store.ts` 同一套:
// `@alwith/module-store` 只认一个 StorePort,这里用 typed bindings 实现它。
import { createStoreClient, type StorePort } from "@alwith/module-store"
import { listen } from "@tauri-apps/api/event"

import { commands, type Value } from "@/bindings"

const port: StorePort = {
  storeEntries: (scope, store) => commands.storeEntries({ scope, store }) as Promise<Record<string, unknown>>,
  async storeSet(scope, store, key, value) {
    await commands.storeSet({ scope, store, key, value: value as Value })
  },
  async storeDelete(scope, store, key) {
    await commands.storeDelete({ scope, store, key })
  },
  async storeClear(scope, store) {
    await commands.storeClear({ scope, store })
  },
  async storeReload(scope, store) {
    await commands.storeReload({ scope, store })
  },
  onStoreChanged: (handler) =>
    listen<{ store: string; key: string; value: unknown }>("store-changed", (event) => handler(event.payload))
}

export const { openStore } = createStoreClient(() => port)
