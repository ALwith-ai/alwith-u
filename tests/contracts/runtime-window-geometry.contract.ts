/** Window geometry contract, the same on both backends: desktop coordinates and restoring across displays. */
import assert from "node:assert/strict"

import { afterAll, beforeAll, describe, test } from "vitest"

import { rpc } from "./lib/app"

type Point = { x: number; y: number }
type Size = { width: number; height: number }
type Monitor = { position: Point; size: Size; scaleFactor: number }

describe("runtime window geometry", () => {
  const call = <T>(command: string, value?: unknown): Promise<T> =>
    rpc("ipc", { window: "main", command: `plugin:window|${command}`, args: { label: "main", value } })
  async function geometry() {
    const [position, inner, size, scale] = await Promise.all([
      call<Point>("outer_position"),
      call<Point>("inner_position"),
      call<Size>("inner_size"),
      call<number>("scale_factor")
    ])
    return { position, inner, size, scale }
  }
  let before: Awaited<ReturnType<typeof geometry>>
  let other: Monitor | undefined

  beforeAll(async () => {
    before = await geometry()
    other = (await call<Monitor[]>("available_monitors")).find((monitor) => monitor.scaleFactor !== before.scale)
  })

  afterAll(async () => {
    await call("set_position", {
      Logical: { x: before.position.x / before.scale, y: before.position.y / before.scale }
    })
    await Bun.sleep(100)
    await call("set_size", {
      Logical: { width: before.size.width / before.scale, height: before.size.height / before.scale }
    })
  })

  test("the content origin is in desktop coordinates", () => {
    // The main window uses an overlay title bar: its content and outer origins coincide.
    assert.deepEqual(before.inner, before.position, "innerPosition must use desktop coordinates")
  })

  test("a window restored from a display of another scale keeps its position and size", async ({ skip }) => {
    if (!other) skip("Needs two displays with different scale factors")
    await call("set_position", {
      Logical: { x: other!.position.x / other!.scaleFactor + 64, y: other!.position.y / other!.scaleFactor + 64 }
    })
    for (let attempt = 0; attempt < 50 && (await call<number>("scale_factor")) !== other!.scaleFactor; attempt++)
      await Bun.sleep(20)
    assert.equal(await call<number>("scale_factor"), other!.scaleFactor, "Window must reach the other display")
    // Match window-state's restore order, without a delay between position and size.
    await call("set_position", { Physical: before.position })
    await call("set_size", { Physical: before.size })
    await Bun.sleep(200)
    const restored = await geometry()
    assert.equal(restored.scale, before.scale)
    assert.deepEqual(restored.position, before.position, "Restoring must not rescale desktop coordinates")
    assert.deepEqual(restored.size, before.size, "Restoring must preserve the saved size across DPI changes")
    assert.deepEqual(restored.inner, restored.position)
  })
})
