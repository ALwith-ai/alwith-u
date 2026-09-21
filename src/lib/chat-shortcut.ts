import { register, unregister } from "@tauri-apps/plugin-global-shortcut"
import { savePreference } from "./preferences"

export type ShortcutHost = {
  register(shortcut: string, handler: () => void): Promise<void>
  unregister(shortcut: string): Promise<void>
  save(shortcut: string): Promise<void>
}

export function createChatShortcut(
  host: ShortcutHost,
  open: () => void
): {
  set(shortcut: string, persist?: boolean): Promise<void>
  dispose(): Promise<void>
} {
  let active = ""
  let pending = Promise.resolve()
  const set = (shortcut: string, persist = true): Promise<void> => {
    const operation = pending.then(async () => {
      if (shortcut === active) {
        if (persist) await host.save(shortcut)
        return
      }
      // Register first: a conflict leaves the working shortcut intact.
      if (shortcut !== "") await host.register(shortcut, open)
      try {
        if (active !== "") await host.unregister(active)
      } catch (error) {
        if (shortcut !== "") await host.unregister(shortcut)
        throw error
      }
      active = shortcut
      if (persist) await host.save(shortcut)
    })
    pending = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }
  return { set, dispose: () => set("", false) }
}

export function installChatShortcut(open: () => void): ReturnType<typeof createChatShortcut> {
  return createChatShortcut(
    {
      register: (shortcut, callback) =>
        register(shortcut, event => {
          if (event.state === "Pressed") callback()
        }),
      unregister,
      save: shortcut => savePreference("chatWindowShortcut", shortcut)
    },
    open
  )
}
