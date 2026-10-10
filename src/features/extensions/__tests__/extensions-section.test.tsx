import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { initI18n } from "@/lib/i18n"
import type { InstallResult, PreparedInstall } from "../install-service"
import { ExtensionsSection } from "../extensions-section"

const ports = vi.hoisted(() => ({ prepare: vi.fn(), install: vi.fn(), report: vi.fn(), success: vi.fn() }))
vi.mock("@/bindings", () => ({ commands: { extensionPrepareInstall: ports.prepare } }))
vi.mock("../install-service", () => ({ executePreparedInstall: ports.install }))
vi.mock("sonner", () => ({ toast: { success: ports.success } }))
vi.mock("../runtime", () => ({
  reportExtensionError: ports.report,
  useExtensions: () => ({
    runtime: {},
    state: { busy: false, errors: {}, native: { installations: [], pending: [] } },
    host: { views: [], instances: [] }
  })
}))

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}
const selected: PreparedInstall = {
  format: "current",
  path: "/extension",
  id: "notes",
  version: "1.0.0",
  digest: "revision"
}
const installed: InstallResult = {
  id: "notes",
  version: "1.0.0",
  packageRevision: "revision",
  installed: true,
  enabled: false,
  activeInMainWindow: false,
  error: null
}
beforeEach(async (): Promise<void> => {
  vi.clearAllMocks()
  await initI18n("en")
})
afterEach(cleanup)

test("shows preparation and installation until completion, then reports success", async (): Promise<void> => {
  const preparation = deferred<PreparedInstall | null>()
  const installation = deferred<InstallResult>()
  ports.prepare.mockReturnValue(preparation.promise)
  ports.install.mockReturnValue(installation.promise)
  render(<ExtensionsSection />)
  fireEvent.click(screen.getByRole("button", { name: "Install from folder" }))
  expect(screen.getByRole("status")).toHaveTextContent("Preparing extension installation…")
  expect(screen.getByRole("button", { name: "Install from folder" })).toBeDisabled()
  await act(async () => preparation.resolve(selected))
  expect(screen.getByRole("status")).toHaveTextContent("Installing extension…")
  expect(ports.install).toHaveBeenCalledOnce()
  await act(async () => installation.resolve(installed))
  expect(screen.queryByRole("status")).toBeNull()
  expect(screen.getByRole("button", { name: "Install from folder" })).toBeEnabled()
  expect(ports.success).toHaveBeenCalledWith("notes installed")
})

test("cancelling the folder picker clears progress without installing or reporting success", async (): Promise<void> => {
  const preparation = deferred<PreparedInstall | null>()
  ports.prepare.mockReturnValue(preparation.promise)
  render(<ExtensionsSection />)
  fireEvent.click(screen.getByRole("button", { name: "Install from folder" }))
  await act(async () => preparation.resolve(null))
  expect(screen.queryByRole("status")).toBeNull()
  expect(screen.getByRole("button", { name: "Install from folder" })).toBeEnabled()
  expect(ports.install).not.toHaveBeenCalled()
  expect(ports.success).not.toHaveBeenCalled()
})

test.each(["preparation", "installation", "activation"])(
  "%s failure clears progress and reports the error",
  async (phase): Promise<void> => {
    const error = new Error("Installation failed")
    ports.prepare.mockImplementation(async (): Promise<PreparedInstall> => {
      if (phase === "preparation") throw error
      return selected
    })
    ports.install.mockImplementation(async (): Promise<InstallResult> => {
      if (phase === "installation") throw error
      return { ...installed, error: { code: "activationFailed", message: error.message } }
    })
    render(<ExtensionsSection />)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Install from folder" })))
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByRole("button", { name: "Install from folder" })).toBeEnabled()
    expect(ports.report).toHaveBeenCalledWith(expect.objectContaining({ message: error.message }))
    expect(ports.success).not.toHaveBeenCalled()
  }
)
