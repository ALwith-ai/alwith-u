import { afterEach, expect, test } from "bun:test"
import type { Channel } from "@tauri-apps/api/core"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import type { ShortcutEvent } from "@tauri-apps/plugin-global-shortcut"
import { installDom } from "@/features/chat/codex/__tests__/dom-environment"
import capability from "../../../src-tauri/capabilities/chat-shortcut.json"
import { installChatShortcut } from "../chat-shortcut"

installDom()
afterEach(clearMocks)

function installNativeShortcuts(): {
  registered: Map<string, Channel<ShortcutEvent>>
  occupied: Set<string>
  failUnregister: Set<string>
  fire(shortcut: string, state: ShortcutEvent["state"]): void
} {
  const registered = new Map<string, Channel<ShortcutEvent>>()
  const occupied = new Set<string>()
  const failUnregister = new Set<string>()
  // The native plugin indexes parsed keys, so these modifier aliases share an ID.
  const nativeKey = (shortcut: string): string => shortcut.replace("Option+", "Alt+")
  mockIPC((command, args): boolean | null => {
    const action = command.replace("plugin:global-shortcut|", "")
    if (!capability.permissions.includes(`global-shortcut:allow-${action.replaceAll("_", "-")}`)) {
      throw new Error(`Shortcut command not permitted: ${command}`)
    }
    if (action === "is_registered") {
      return registered.has(nativeKey((args as { shortcut: string }).shortcut))
    }
    const { shortcuts, handler } = args as { shortcuts: string[]; handler: Channel<ShortcutEvent> }
    for (const value of shortcuts) {
      const shortcut = nativeKey(value)
      if (action === "register") {
        if (registered.has(shortcut) || occupied.has(shortcut)) throw new Error("Shortcut already registered")
        registered.set(shortcut, handler)
      } else if (action === "unregister") {
        if (failUnregister.has(shortcut)) throw new Error("Unable to unregister shortcut")
        if (!registered.delete(shortcut)) throw new Error("Shortcut not registered by this app")
      } else {
        throw new Error(`Unexpected shortcut command: ${command}`)
      }
    }
    return null
  })
  return {
    registered,
    occupied,
    failUnregister,
    fire(shortcut, state): void {
      const handler = registered.get(shortcut)
      if (!handler) throw new Error(`No handler for ${shortcut}`)
      handler.onmessage({ shortcut, state, id: 1 })
    }
  }
}

test("reload replaces the retained native registration with the new page callback", async (): Promise<void> => {
  const native = installNativeShortcuts()
  let oldOpens = 0
  let newOpens = 0
  const oldPage = installChatShortcut(() => oldOpens++)
  await oldPage.set("Alt+Space", false)

  // A webview reload destroys JS without awaiting React's asynchronous cleanup.
  const newPage = installChatShortcut(() => newOpens++)
  await newPage.set("Alt+Space", false)
  native.fire("Alt+Space", "Released")
  expect(newOpens).toBe(0)
  native.fire("Alt+Space", "Pressed")
  expect(oldOpens).toBe(0)
  expect(newOpens).toBe(1)
  expect([...native.registered.keys()]).toEqual(["Alt+Space"])
  await newPage.dispose()
  expect(native.registered.size).toBe(0)
})

test("native conflicts keep the working shortcut and callback", async (): Promise<void> => {
  const native = installNativeShortcuts()
  native.occupied.add("Alt+Space")
  let opens = 0
  const shortcut = installChatShortcut(() => opens++)
  await shortcut.set("Control+Shift+Space", false)
  await expect(shortcut.set("Alt+Space", false)).rejects.toThrow("Shortcut already registered")
  expect([...native.registered.keys()]).toEqual(["Control+Shift+Space"])
  native.fire("Control+Shift+Space", "Pressed")
  expect(opens).toBe(1)
  await shortcut.dispose()
})

test("failed reload cleanup is reported and can be retried", async (): Promise<void> => {
  const native = installNativeShortcuts()
  const oldPage = installChatShortcut(() => {})
  await oldPage.set("Alt+Space", false)
  native.failUnregister.add("Alt+Space")
  let opens = 0
  const newPage = installChatShortcut(() => opens++)
  await expect(newPage.set("Alt+Space", false)).rejects.toThrow("Unable to unregister shortcut")
  native.failUnregister.clear()
  await newPage.set("Alt+Space", false)
  native.fire("Alt+Space", "Pressed")
  expect(opens).toBe(1)
  await newPage.dispose()
})

test("changing to an equivalent shortcut cannot unregister the working binding", async (): Promise<void> => {
  const native = installNativeShortcuts()
  let opens = 0
  const shortcut = installChatShortcut(() => opens++)
  await shortcut.set("Alt+Space", false)
  await expect(shortcut.set("Option+Space", false)).rejects.toThrow("Shortcut already registered")
  native.fire("Alt+Space", "Pressed")
  expect(opens).toBe(1)
  await shortcut.dispose()
  expect(native.registered.size).toBe(0)
})
