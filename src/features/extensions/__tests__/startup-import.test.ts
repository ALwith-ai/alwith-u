import { describe, expect, it, vi } from "vitest"
import { runStartupImports, type StartupImportPort } from "../startup-import"

function fixture(): StartupImportPort {
  return {
    scan: vi.fn(async () => ({ tasks: ["a", "b"], errors: [] })),
    prepare: vi.fn(async (id: string) => ({
      id,
      phase: "prepared" as const,
      package: { path: id, id, version: "1.0.0", digest: id, source: "local" }
    })),
    install: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    failed: vi.fn(async () => {}),
    report: vi.fn()
  }
}

describe("startup imports", () => {
  it("installs serially and cleans only after success", async () => {
    const port = fixture()
    const calls: string[] = []
    port.install = async pkg => {
      calls.push(`install:${pkg.id}`)
    }
    port.complete = async id => {
      calls.push(`clean:${id}`)
    }
    await runStartupImports(port)
    expect(calls).toEqual(["install:a", "clean:a", "install:b", "clean:b"])
  })
  it("keeps failed inputs and continues with other tasks", async () => {
    const port = fixture()
    port.install = vi.fn(async pkg => {
      if (pkg.id === "a") throw new Error("activation failed")
    })
    await runStartupImports(port)
    expect(port.complete).toHaveBeenCalledExactlyOnceWith("b")
    expect(port.failed).toHaveBeenCalledWith("a", "activation failed")
    expect(port.report).toHaveBeenCalledWith("activation failed")
  })
  it("does not reinstall committed tasks when retrying cleanup", async () => {
    const port = fixture()
    port.prepare = vi.fn(async (id: string) => ({ id, phase: "committed" as const, package: null }))
    await runStartupImports(port)
    expect(port.install).not.toHaveBeenCalled()
    expect(port.complete).toHaveBeenCalledTimes(2)
  })
  it("reports failure to persist errors and continues", async () => {
    const port = fixture()
    port.install = async () => {
      throw new Error("install failed")
    }
    port.failed = async () => {
      throw new Error("disk full")
    }
    await runStartupImports(port)
    expect(port.complete).not.toHaveBeenCalled()
    expect(port.report).toHaveBeenCalledWith(expect.stringContaining("disk full"))
  })
})
