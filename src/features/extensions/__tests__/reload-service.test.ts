import { expect, test } from "vitest"
import { runExtensionReload, type ReloadPort } from "../reload-service"

function fixture(): { port: ReloadPort; calls: string[] } {
  const calls: string[] = []
  const port: ReloadPort = {
    scan: async () => ({ tasks: [], errors: [] }),
    prepare: async id => ({
      id,
      phase: "prepared",
      package: { id: "notes", path: "/package", version: "2.0.0", digest: "new", source: "local" }
    }),
    install: async () => {
      calls.push("install")
      return "updated"
    },
    reload: async () => {
      calls.push("reload")
    },
    complete: async () => {
      calls.push("clean")
    },
    failed: async () => {
      calls.push("failed")
    },
    finish: async () => {
      calls.push("finish")
    }
  }
  return { port, calls }
}

test("no pending package reloads the installed extension", async () => {
  const { port, calls } = fixture()
  expect(await runExtensionReload("notes", port)).toBe("reloaded")
  expect(calls).toEqual(["reload", "finish"])
})

test("preparation failure preserves the running instance and the source", async () => {
  const { port, calls } = fixture()
  port.scan = async () => ({ tasks: ["task"], errors: [] })
  port.prepare = async () => {
    throw new Error("Invalid package")
  }
  await expect(runExtensionReload("notes", port)).rejects.toThrow("Invalid package")
  expect(calls).toEqual(["failed", "finish"])
})

test("a prepared update is installed before source cleanup", async () => {
  const { port, calls } = fixture()
  port.scan = async () => ({ tasks: ["task"], errors: [] })
  port.install = async () => {
    calls.push("install")
    return "updated"
  }
  expect(await runExtensionReload("notes", port)).toBe("updated")
  expect(calls).toEqual(["install", "clean", "finish"])
})

test("same-package install verification falls back to reload before cleanup", async () => {
  const { port, calls } = fixture()
  port.scan = async () => ({ tasks: ["task"], errors: [] })
  port.install = async () => {
    calls.push("verify")
    return "unchanged"
  }
  expect(await runExtensionReload("notes", port)).toBe("reloaded")
  expect(calls).toEqual(["verify", "reload", "clean", "finish"])
})

test("activation failure retains source and releases scan ownership", async () => {
  const { port, calls } = fixture()
  port.scan = async () => ({ tasks: ["task"], errors: [] })
  port.install = async () => {
    calls.push("install")
    throw new Error("Activation failed")
  }
  await expect(runExtensionReload("notes", port)).rejects.toThrow("Activation failed")
  expect(calls).toEqual(["install", "failed", "finish"])
})

test("duplicate inputs stop before preparation or reload", async () => {
  const { port, calls } = fixture()
  port.scan = async () => ({ tasks: [], errors: ["Duplicate input"] })
  await expect(runExtensionReload("notes", port)).rejects.toThrow("Duplicate input")
  expect(calls).toEqual(["finish"])
})

test("a rejected scan cannot release another window's operation", async () => {
  const { port, calls } = fixture()
  port.scan = async () => {
    throw new Error("Another import is active")
  }
  await expect(runExtensionReload("notes", port)).rejects.toThrow("Another import is active")
  expect(calls).toEqual([])
})

test("committed tasks finish cleanup before checking for a newer package", async () => {
  const { port, calls } = fixture()
  let scans = 0
  port.scan = async () => ({ tasks: scans++ === 0 ? ["task"] : [], errors: [] })
  port.prepare = async id => ({ id, phase: "committed", package: null })
  expect(await runExtensionReload("notes", port)).toBe("reloaded")
  expect(calls).toEqual(["clean", "finish", "reload", "finish"])
})

test("operation and ownership release failures are both reported", async () => {
  const { port } = fixture()
  port.reload = async () => {
    throw new Error("Activation failed")
  }
  port.finish = async () => {
    throw new Error("Could not release operation")
  }
  await expect(runExtensionReload("notes", port)).rejects.toThrow(
    "Activation failed; Error: Could not release operation"
  )
})

test("cleanup recovery rescans and installs the waiting new package", async () => {
  const { port, calls } = fixture()
  let scans = 0
  port.scan = async () => ({ tasks: [scans++ === 0 ? "old" : "new"], errors: [] })
  port.reload = async () => {
    throw new Error("Old version cannot activate")
  }
  const prepare = port.prepare
  port.prepare = async id => (id === "old" ? { id, phase: "committed", package: null } : prepare(id))
  expect(await runExtensionReload("notes", port)).toBe("updated")
  expect(calls).toEqual(["clean", "finish", "install", "clean", "finish"])
})
