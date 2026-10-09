import { createPetAssets, type PetAccount } from "@alwith/module-auth/pets"
import { invoke } from "@tauri-apps/api/core"
import { emit, listen } from "@tauri-apps/api/event"
import { LazyStore } from "@tauri-apps/plugin-store"
import { API_BASE_URL, platformApiRequest, usePlatformAuth } from "./store"

const store = new LazyStore("vibemon.json")
let writes = Promise.resolve()
const CHANGED = "vibemon:assets-changed"
const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0))
function encode(bytes: Uint8Array): string {
  let value = ""
  for (let start = 0; start < bytes.length; start += 32_768)
    value += String.fromCharCode(...bytes.subarray(start, start + 32_768))
  return btoa(value)
}
export function createPlatformPetAssets() {
  let revision = 0
  let identity: string | null = null
  const account = (): PetAccount | null => {
    const user = usePlatformAuth.getState().user
    const next = user === null ? null : user.user_uuid
    if (next !== identity) {
      identity = next
      revision++
    }
    return user === null ? null : { apiHost: new URL(API_BASE_URL).host, userId: user.user_uuid, revision }
  }
  const listeners = new Set<() => void>()
  const storage = {
    get: <T>(key: string) => store.get<T>(key),
    set(key: string, value: unknown) {
      const write = writes
        .catch(() => {})
        .then(async () => {
          const previous = await store.get(key)
          await store.set(key, value)
          try {
            await store.save()
          } catch (error) {
            if (previous === undefined) await store.delete(key)
            else await store.set(key, previous)
            throw error
          }
          await emit(CHANGED)
          for (const listener of listeners) listener()
        })
      writes = write
      return write
    }
  }
  const assets = createPetAssets({
    account,
    storage,
    request: platformApiRequest,
    resources: {
      exists: path => invoke<boolean>("vibemon_resource", { action: "exists", path, bytes: null, destination: null }),
      async read(path) {
        const value = await invoke<string | null>("vibemon_resource", {
          action: "read",
          path,
          bytes: null,
          destination: null
        })
        return value === null ? null : decode(value)
      },
      write: (path, bytes) =>
        invoke("vibemon_resource", { action: "write", path, bytes: encode(bytes), destination: null }),
      replace: (temporary, destination) =>
        invoke("vibemon_resource", { action: "replace", path: temporary, destination, bytes: null }),
      remove: path => invoke("vibemon_resource", { action: "remove", path, bytes: null, destination: null })
    },
    async download(url, signal) {
      signal.throwIfAborted()
      const result = await invoke<string>("vibemon_download", { url })
      signal.throwIfAborted()
      return decode(result)
    }
  })
  const stopAuth = usePlatformAuth.subscribe((state, previous) => {
    if (state.user?.user_uuid !== previous.user?.user_uuid) {
      account()
      assets.invalidate()
      for (const listener of listeners) listener()
    }
  })
  const subscription = listen(CHANGED, () => {
    for (const listener of listeners) listener()
  })
  return {
    assets,
    storage,
    account,
    subscribeStorage(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      stopAuth()
      void subscription.then(stop => stop())
      assets.dispose()
      listeners.clear()
    }
  }
}
