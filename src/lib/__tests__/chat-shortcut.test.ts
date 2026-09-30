import { expect, test } from "bun:test"
import { createChatShortcut, type ShortcutHost } from "../chat-shortcut"

test("shortcut conflicts preserve the working registration and preference", async () => {
  const registered = new Set<string>()
  let saved = ""
  const host: ShortcutHost = {
    register: async shortcut => {
      if (shortcut === "Alt+Space") throw new Error("Shortcut already registered")
      registered.add(shortcut)
    },
    unregister: async shortcut => {
      registered.delete(shortcut)
    },
    save: async shortcut => {
      saved = shortcut
    }
  }
  const shortcut = createChatShortcut(host, () => {})
  await shortcut.set("Control+Shift+Space")
  await expect(shortcut.set("Alt+Space")).rejects.toThrow("already registered")
  expect([...registered]).toEqual(["Control+Shift+Space"])
  expect(saved).toBe("Control+Shift+Space")
  await shortcut.dispose()
  expect(registered.size).toBe(0)
  expect(saved).toBe("Control+Shift+Space")
})

test("overlapping shortcut changes serialize and disabling persists an empty preference", async () => {
  const registered = new Set<string>()
  const saved: string[] = []
  const shortcut = createChatShortcut(
    {
      register: async value => {
        registered.add(value)
      },
      unregister: async value => {
        registered.delete(value)
      },
      save: async value => {
        saved.push(value)
      }
    },
    () => {}
  )
  await Promise.all([shortcut.set("Control+Space"), shortcut.set("Control+Shift+Space"), shortcut.set("")])
  expect(registered.size).toBe(0)
  expect(saved).toEqual(["Control+Space", "Control+Shift+Space", ""])
})
