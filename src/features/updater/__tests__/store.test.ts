// The Rust side owns the state machine (cargo test in src-tauri/src/updater); this covers the
// reflection layer: fetch once, follow events, ask to relaunch exactly once per ready version.
import { expect, test } from "vitest"
import { must } from "@/lib/__tests__/must"
import { createUpdaterStore, type UpdaterIo, type UpdaterState } from "../store"

function fakeIo(initial: UpdaterState, accept = false) {
  const calls = { getState: 0, listen: 0, ask: 0, install: 0 }
  let emit: ((state: UpdaterState) => void) | undefined
  const io: UpdaterIo = {
    getState: async () => {
      calls.getState += 1
      return initial
    },
    onStateChange: async handler => {
      calls.listen += 1
      emit = handler
      return () => undefined
    },
    askRelaunch: async () => {
      calls.ask += 1
      return accept
    },
    installAndRelaunch: async () => {
      calls.install += 1
    }
  }
  return { io, calls, emit: (state: UpdaterState) => must(emit, "a registered state listener")(state) }
}

const ready: UpdaterState = {
  type: "ready",
  update: { version: "0.2.0", filename: "x.tar.gz", signature: "sig", contentLength: 100 }
}

test("init fetches the state once, subscribes once, and is idempotent", async () => {
  const { io, calls } = fakeIo({ type: "idle" })
  const store = createUpdaterStore(io)
  await store.getState().init()
  await store.getState().init()
  expect(calls.getState).toBe(1)
  expect(calls.listen).toBe(1)
  expect(store.getState().state.type).toBe("idle")
})

test("state events update the store", async () => {
  const { io, emit } = fakeIo({ type: "idle" })
  const store = createUpdaterStore(io)
  await store.getState().init()
  emit({ type: "downloading", update: ready.update, downloadedBytes: 10, totalBytes: 100 })
  expect(store.getState().state).toEqual({
    type: "downloading",
    update: ready.update,
    downloadedBytes: 10,
    totalBytes: 100
  })
})

test("a ready update asks to relaunch once per version and installs only on acceptance", async () => {
  const declined = fakeIo({ type: "idle" })
  const store = createUpdaterStore(declined.io)
  await store.getState().init()
  declined.emit(ready)
  declined.emit(ready)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(declined.calls.ask).toBe(1)
  expect(declined.calls.install).toBe(0)

  const accepted = fakeIo(ready, true)
  await createUpdaterStore(accepted.io).getState().init()
  expect(accepted.calls.ask).toBe(1)
  expect(accepted.calls.install).toBe(1)
})

test("confirmInstallAndRelaunch surfaces install failures", async () => {
  const { io } = fakeIo({ type: "idle" }, true)
  io.installAndRelaunch = async () => {
    throw new Error("disk full")
  }
  await expect(createUpdaterStore(io).getState().confirmInstallAndRelaunch()).rejects.toThrow("disk full")
})

test("an event received during the initial snapshot wins over stale state", async () => {
  const { io, emit, calls } = fakeIo({ type: "idle" })
  io.getState = async () => {
    if (calls.listen) emit(ready)
    return { type: "idle" }
  }
  const store = createUpdaterStore(io)
  await store.getState().init()
  expect(store.getState().state).toEqual(ready)
  expect(calls.ask).toBe(1)
})

test("settings follows ready state without automatically prompting but can install manually", async () => {
  const { io, emit, calls } = fakeIo(ready, true)
  const store = createUpdaterStore(io)
  await store.getState().init(false)
  emit(ready)
  expect(store.getState().state).toEqual(ready)
  expect(calls.ask).toBe(0)
  await store.getState().confirmInstallAndRelaunch()
  expect(calls.install).toBe(1)
})

test("snapshot failure unsubscribes and permits initialization retry", async () => {
  const { io, calls } = fakeIo({ type: "idle" })
  let unsubscribed = 0
  const listen = io.onStateChange
  io.onStateChange = async handler => {
    await listen(handler)
    return () => {
      unsubscribed += 1
    }
  }
  io.getState = async () => {
    throw new Error("IPC unavailable")
  }
  const store = createUpdaterStore(io)
  await expect(store.getState().init()).rejects.toThrow("IPC unavailable")
  expect(unsubscribed).toBe(1)
  expect(store.getState().initialized).toBe(false)
  io.getState = async () => ready
  await store.getState().init()
  expect(store.getState().state).toEqual(ready)
  expect(calls.listen).toBe(2)
})
