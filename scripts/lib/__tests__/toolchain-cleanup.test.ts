import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ProcessRuntimeClient } from "@alwith/api/node"
import { removeTemporaryDirectory, stopRuntime, withCleanup } from "../toolchain-cleanup"

type Runtime = Pick<ProcessRuntimeClient, "onExit" | "stop" | "close" | "kill">

function runtimeFixture(): {
  runtime: Runtime
  calls: string[]
  agentExit: (agentId: string) => void
  processExit: () => void
  exited: Promise<void>
} {
  const calls: string[] = []
  const process = Promise.withResolvers<void>()
  let handler: Parameters<ProcessRuntimeClient["onExit"]>[0] | undefined
  return {
    calls,
    exited: process.promise,
    agentExit: (agentId: string): void => handler?.({ agentId }),
    processExit: (): void => process.resolve(),
    runtime: {
      onExit: async callback => {
        calls.push("subscribe")
        handler = callback
        return (): void => {
          calls.push("unsubscribe")
          handler = undefined
        }
      },
      stop: async agentId => {
        calls.push(`stop:${agentId}`)
      },
      close: (): void => {
        calls.push("close")
      },
      kill: (): void => {
        calls.push("kill")
        process.resolve()
      }
    }
  }
}

test("shutdown waits for the selected agent exit and then the Runtime exit", async () => {
  const fixture = runtimeFixture()
  let completed = false
  const stopping = stopRuntime(fixture.runtime, fixture.exited, true, 1000).then(() => {
    completed = true
  })
  await Bun.sleep(0)
  expect(fixture.calls).toEqual(["subscribe", "stop:codex"])
  fixture.agentExit("other")
  await Bun.sleep(0)
  expect(fixture.calls).not.toContain("close")
  fixture.agentExit("codex")
  await Bun.sleep(0)
  expect(fixture.calls).toEqual(["subscribe", "stop:codex", "unsubscribe", "close"])
  expect(completed).toBe(false)
  fixture.processExit()
  await stopping
  expect(completed).toBe(true)
})

test("a failed start closes the Runtime without waiting for a nonexistent agent", async () => {
  const fixture = runtimeFixture()
  fixture.processExit()
  await stopRuntime(fixture.runtime, fixture.exited, false, 1000)
  expect(fixture.calls).toEqual(["close"])
})

test("agent stop failure still closes Runtime and preserves the failure", async () => {
  const fixture = runtimeFixture()
  const failure = new Error("stop rejected")
  fixture.runtime.stop = async (): Promise<void> => {
    throw failure
  }
  fixture.processExit()
  await expect(stopRuntime(fixture.runtime, fixture.exited, true, 1000)).rejects.toBe(failure)
  expect(fixture.calls).toEqual(["subscribe", "unsubscribe", "close"])
})

test("a missing agent exit is bounded and still closes Runtime", async () => {
  const fixture = runtimeFixture()
  fixture.processExit()
  await expect(stopRuntime(fixture.runtime, fixture.exited, true, 10)).rejects.toThrow("timed out")
  expect(fixture.calls).toEqual(["subscribe", "stop:codex", "unsubscribe", "close"])
})

test("Runtime exit timeout kills it but does not report graceful shutdown", async () => {
  const fixture = runtimeFixture()
  await expect(stopRuntime(fixture.runtime, fixture.exited, false, 10)).rejects.toThrow("timed out")
  expect(fixture.calls).toEqual(["close", "kill"])
})

test("temporary lock errors are retried asynchronously before directory removal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "alwith-cleanup-"))
  writeFileSync(join(directory, "probe.txt"), "probe")
  const delays: number[] = []
  let attempts = 0
  try {
    await removeTemporaryDirectory(
      directory,
      async (path, options) => {
        attempts++
        expect(path).toBe(directory)
        expect(options).toEqual({ recursive: true, force: true })
        if (attempts <= 3)
          throw Object.assign(new Error("locked"), { code: ["EBUSY", "EPERM", "ENOTEMPTY"][attempts - 1] })
        await rm(path, options)
      },
      async milliseconds => {
        delays.push(milliseconds)
      }
    )
    expect(attempts).toBe(4)
    expect(delays).toEqual([200, 400, 600])
    expect(existsSync(directory)).toBe(false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("a permanent lock exhausts a finite retry budget and preserves the error", async () => {
  const failure = Object.assign(new Error("locked"), { code: "EBUSY" })
  let attempts = 0
  const delays: number[] = []
  await expect(
    removeTemporaryDirectory(
      "unused",
      async () => {
        attempts++
        throw failure
      },
      async milliseconds => {
        delays.push(milliseconds)
      }
    )
  ).rejects.toBe(failure)
  expect(attempts).toBe(7)
  expect(delays).toEqual([200, 400, 600, 800, 1000, 1200])
})

test("non-lock errors fail immediately without a retry", async () => {
  const failure = Object.assign(new Error("I/O failure"), { code: "EIO" })
  let attempts = 0
  await expect(
    removeTemporaryDirectory(
      "unused",
      async () => {
        attempts++
        throw failure
      },
      async () => {
        throw new Error("unexpected retry")
      }
    )
  ).rejects.toBe(failure)
  expect(attempts).toBe(1)
})

test("cleanup failure prevents a successful result", async () => {
  const failure = new Error("cleanup failed")
  await expect(
    withCleanup(
      async () => "success",
      async () => {
        throw failure
      }
    )
  ).rejects.toBe(failure)
})

test("verification and cleanup failures are both retained", async () => {
  const primary = new Error("initialization failed")
  const cleanup = new Error("cleanup failed")
  const result = await withCleanup(
    async () => {
      throw primary
    },
    async () => {
      throw cleanup
    }
  ).catch((error: unknown) => error)
  expect(result).toBeInstanceOf(AggregateError)
  expect((result as AggregateError).errors).toEqual([primary, cleanup])
})

test("successful cleanup preserves the original failure or result", async () => {
  const primary = new Error("initialization failed")
  await expect(
    withCleanup(
      async () => {
        throw primary
      },
      async () => {}
    )
  ).rejects.toBe(primary)
  expect(
    await withCleanup(
      async () => "verified",
      async () => {}
    )
  ).toBe("verified")
})
