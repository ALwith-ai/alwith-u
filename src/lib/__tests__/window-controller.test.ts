import { expect, test } from "vitest"
import { createWindowController } from "../window-controller"

test("concurrent opens create one window and deliver each intent after readiness", async () => {
  const delivered: string[] = []
  let created = 0
  let ready!: () => void
  const prepared = new Promise<void>(resolve => {
    ready = resolve
  })
  let exists = false
  const controller = createWindowController<string>({
    exists: async () => exists,
    create: async () => {
      created++
      await prepared
      exists = true
    },
    present: async () => {},
    deliver: async intent => {
      delivered.push(intent)
    }
  })
  const first = controller.open("one")
  const second = controller.open("two")
  await Promise.resolve()
  expect(delivered).toEqual([])
  ready()
  await Promise.all([first, second])
  expect(created).toBe(1)
  expect(delivered).toEqual(["one", "two"])
  await controller.open()
  expect(created).toBe(1)
  expect(delivered).toEqual(["one", "two"])
})

test("a failed creation rejects its caller and permits a later explicit open", async () => {
  let attempts = 0
  const controller = createWindowController<string>({
    exists: async () => false,
    create: async () => {
      if (++attempts === 1) throw new Error("creation failed")
    },
    present: async () => {},
    deliver: async () => {}
  })
  await expect(controller.open()).rejects.toThrow("creation failed")
  await controller.open()
  expect(attempts).toBe(2)
})
