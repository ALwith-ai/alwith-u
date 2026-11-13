import { commands } from "@alwith/module-fs/commands"
import { createTauriAdapter } from "@alwith/module-fs/tauri"
import { expect, test, vi } from "vitest"

const native = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock("@tauri-apps/api/event", async (original) => ({ ...(await original<object>()), listen: native.listen }))

test("native watch errors invalidate the root before reporting and stop cleanly", async () => {
  let notify!: (event: { payload: { root: string; paths: string[]; error: string | null } }) => void
  const stop = vi.fn()
  native.listen.mockImplementation(async (_name, handler) => {
    notify = handler
    return stop
  })
  const watch = vi.spyOn(commands, "workspaceWatch").mockResolvedValue(null)
  const changed = vi.fn()
  const error = vi.fn()
  try {
    const adapter = createTauriAdapter({ root: "/repo" })
    if (!adapter.watch) throw new Error("Missing watch adapter")
    const dispose = await adapter.watch("/repo", changed, error)
    notify({ payload: { root: "/other", paths: [], error: "Other root removed" } })
    expect(changed).not.toHaveBeenCalled()
    notify({ payload: { root: "/repo", paths: [], error: "Watched root removed" } })
    expect(changed).toHaveBeenCalledWith(["/repo"])
    expect(error).toHaveBeenCalledWith(new Error("Watched root removed"))
    dispose()
    expect(stop).toHaveBeenCalledOnce()
    expect(watch).toHaveBeenLastCalledWith({ root: "/repo", enabled: false })
  } finally {
    watch.mockRestore()
  }
})
