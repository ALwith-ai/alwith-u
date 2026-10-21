import { describe, expect, it, vi } from "vitest"

import { runStartupImports, type StartupImportPort } from "../startup-import"

function fixture(): StartupImportPort {
  return {
    scan: vi.fn(() => Promise.resolve({ tasks: ["a", "b"], errors: [] })),
    prepare: vi.fn((id: string) =>
      Promise.resolve({
        id,
        phase: "prepared" as const,
        package: { path: id, id, version: "1.0.0", digest: id, source: "local" }
      })
    ),
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
    port.install = (pkg) => {
      return Promise.try(() => {
        calls.push(`install:${pkg.id}`)
      })
    }
    port.complete = (id) => {
      return Promise.try(() => {
        calls.push(`clean:${id}`)
      })
    }
    await runStartupImports(port)
    expect(calls).toEqual(["install:a", "clean:a", "install:b", "clean:b"])
  })
  it("keeps failed inputs and continues with other tasks", async () => {
    const port = fixture()
    port.install = vi.fn((pkg: Parameters<StartupImportPort["install"]>[0]) => {
      return Promise.try(() => {
        if (pkg.id === "a") throw new Error("activation failed")
      })
    })
    await runStartupImports(port)
    expect(port.complete).toHaveBeenCalledExactlyOnceWith("b")
    expect(port.failed).toHaveBeenCalledWith("a", "activation failed")
    expect(port.report).toHaveBeenCalledWith("activation failed")
  })
  it("does not reinstall committed tasks when retrying cleanup", async () => {
    const port = fixture()
    port.prepare = vi.fn((id: string) => Promise.resolve({ id, phase: "committed" as const, package: null }))
    await runStartupImports(port)
    expect(port.install).not.toHaveBeenCalled()
    expect(port.complete).toHaveBeenCalledTimes(2)
  })
  it("reports failure to persist errors and continues", async () => {
    const port = fixture()
    port.install = () => {
      return Promise.try(() => {
        throw new Error("install failed")
      })
    }
    port.failed = () => {
      return Promise.try(() => {
        throw new Error("disk full")
      })
    }
    await runStartupImports(port)
    expect(port.complete).not.toHaveBeenCalled()
    expect(port.report).toHaveBeenCalledWith(expect.stringContaining("disk full"))
  })
})

it("releases scan ownership after processing failures", async () => {
  const port = fixture()
  port.install = () => {
    return Promise.try(() => {
      throw new Error("Invalid package")
    })
  }
  port.finish = vi.fn(async () => {})
  await runStartupImports(port)
  expect(port.finish).toHaveBeenCalledOnce()
  expect(port.failed).toHaveBeenCalledTimes(2)
})
