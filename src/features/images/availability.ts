import { hasAccount } from "@alwith/module-chat/client"
import { imageModel } from "@alwith/module-chat/image"
import { listen } from "@tauri-apps/api/event"
import { useEffect } from "react"
import { create, useStore } from "zustand"

import { client } from "@/lib/client"
import { ACCOUNT_CHANGED } from "@/lib/settings-bridge"

import { refreshImageProviders, saveImageSelection, selectableImageModels, useImagePreferences } from "./preferences"
import { IMAGE_PROVIDERS_CHANGED } from "./provider-events"

const account = create<{ connected: boolean | null; error: string | null }>(() => ({ connected: null, error: null }))
let refresh: Promise<void> | null = null
let revision = 0

/** Availability contains no credentials and is refreshed through the existing ACP owner. */
async function refreshAvailability(): Promise<void> {
  if (client.state.connection !== "ready") return
  ++revision
  if (refresh) return refresh
  refresh = (async () => {
    let read: number
    do {
      read = revision
      const identity = client.state.agent
      const [auth, provider] = await Promise.allSettled([
        hasAccount(identity) ? client.readAccount() : Promise.resolve(null),
        refreshImageProviders()
      ])
      if (client.state.connection !== "ready") return
      if (client.state.agent !== identity) {
        ++revision
        continue
      }
      if (auth.status === "fulfilled") account.setState({ connected: auth.value?.account?.type === "chatgpt" })
      const failure = auth.status === "rejected" ? auth.reason : provider.status === "rejected" ? provider.reason : null
      account.setState({ error: failure ? String(failure instanceof Error ? failure.message : failure) : null })
      const { selection, seedreamConfigured } = useImagePreferences.getState()
      const connected = account.getState().connected
      const selected = imageModel(selection)
      const usable = selected.provider === "chatgpt" ? connected === true : seedreamConfigured === true
      if (!usable) {
        const next = selectableImageModels.find((model) =>
          model.provider === "chatgpt" ? connected === true : seedreamConfigured === true
        )
        if (next) await saveImageSelection({ model: next.id, size: next.sizes[0] })
      }
    } while (read !== revision)
  })().finally(() => {
    refresh = null
  })
  return refresh
}

export function useImageAvailability(enabled = true) {
  const connection = useStore(client.store, (state) => state.connection)
  const connected = account((state) => state.connected)
  const error = account((state) => state.error)
  const configured = useImagePreferences((state) => state.seedreamConfigured)
  const selection = useImagePreferences((state) => state.selection)
  useEffect(() => {
    if (!enabled) return
    let active = true
    const update = () => {
      void refreshAvailability().catch((cause: unknown) => {
        if (active) account.setState({ error: cause instanceof Error ? cause.message : String(cause) })
      })
    }
    update()
    window.addEventListener("focus", update)
    const stop = Promise.all([listen(IMAGE_PROVIDERS_CHANGED, update), listen(ACCOUNT_CHANGED, update)])
    void stop.catch((cause: unknown) => {
      if (active) account.setState({ error: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => {
      active = false
      window.removeEventListener("focus", update)
      void stop.then(
        (unlisten) => unlisten.forEach((stop) => stop()),
        () => undefined
      )
    }
  }, [connection, enabled])
  const available = connected === true || configured === true
  const provider = imageModel(selection).provider
  return {
    available,
    chatgptConnected: connected,
    seedreamConfigured: configured,
    canGenerate: connection === "ready" && (provider === "chatgpt" ? connected === true : configured === true),
    checking: !error && (connection !== "ready" || connected === null || configured === null),
    error,
    retry: refreshAvailability
  }
}
