import { createPetAssets, type PetAccount } from "@alwith/module-auth/pets"
import { convertFileSrc, invoke } from "@tauri-apps/api/core"
import { emit, listen } from "@tauri-apps/api/event"

import { logBackgroundError } from "@/lib/background-errors"
import { openStore } from "@/lib/store"

import { API_BASE_URL, platformApiRequest, usePlatformAuth } from "./store"

// 同一个 `appDataDir/vibemon.json`;set 失败时内存与磁盘都不变,不需要手工回滚。
const store = openStore("vibemon")
let writes = Promise.resolve()
const CHANGED = "vibemon:assets-changed"
function decode(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
function encode(bytes: Uint8Array): string {
  let value = ""
  for (let start = 0; start < bytes.length; start += 32_768)
    value += String.fromCharCode(...bytes.subarray(start, start + 32_768))
  return btoa(value)
}
export function createPlatformPetAssets() {
  const reads = new Map<string, Promise<Uint8Array | null>>()
  const resourceUrl = async (path: string) =>
    convertFileSrc(await invoke<string>("vibemon_resource", { action: "url", path, bytes: null, destination: null }))
  function readResource(path: string): Promise<Uint8Array | null> {
    const pending = reads.get(path)
    if (pending) return pending
    const work = (async () => {
      if (path.endsWith(".json")) {
        const value = await invoke<string | null>("vibemon_resource", {
          action: "read",
          path,
          bytes: null,
          destination: null
        })
        return value === null ? null : decode(value)
      }
      const exists = await invoke<boolean>("vibemon_resource", {
        action: "exists",
        path,
        bytes: null,
        destination: null
      })
      if (!exists) return null
      // Transfer binary files directly; Base64 IPC blocks the webview on large packages.
      const response = await fetch(await resourceUrl(path), { cache: "no-store" })
      if (!response.ok) throw new Error(`Cannot read cached Vibemon resource: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    })().finally(() => {
      if (reads.get(path) === work) reads.delete(path)
    })
    reads.set(path, work)
    return work
  }
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
          await store.set(key, value)
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
    onResourceError: (error, id) => logBackgroundError(`pet-resource/${id}`, error),
    async validateImage(bytes, mime) {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: mime }))
      try {
        const image = new Image()
        image.src = url
        await image.decode()
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    resources: {
      url: resourceUrl,
      exists: (path) => invoke<boolean>("vibemon_resource", { action: "exists", path, bytes: null, destination: null }),
      read: readResource,
      write: (path, bytes) =>
        invoke("vibemon_resource", { action: "write", path, bytes: encode(bytes), destination: null }),
      replace: (temporary, destination) =>
        invoke("vibemon_resource", { action: "replace", path: temporary, destination, bytes: null }),
      remove: (path) => invoke("vibemon_resource", { action: "remove", path, bytes: null, destination: null })
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
      void subscription.then((stop) => stop())
      assets.dispose()
      listeners.clear()
    }
  }
}
