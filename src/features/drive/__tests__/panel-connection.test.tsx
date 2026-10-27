import { createDriveController, type DriveResponse, type Snapshot } from "@alwith/module-drive"
import { DrivePanel } from "@alwith/module-drive/react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, test } from "vitest"

import { driveControls } from "../controls"

afterEach(cleanup)

test("settings connection failure can retry through progress into the login form", async () => {
  const ready = Promise.withResolvers<DriveResponse>()
  const snapshot: Snapshot = {
    version: 1,
    generation: 1,
    sequence: 0,
    configured: false,
    running: false,
    baseUrl: "",
    localRoot: "",
    webBaseUrl: null,
    roots: [],
    status: null,
    files: [],
    projects: [],
    pendingDeletes: [],
    error: null
  }
  let fail = true
  const controller = createDriveController({
    subscribe: () => {
      if (fail) return Promise.reject(new Error("Drive subscription unavailable"))
      return Promise.resolve(() => {})
    },
    request: () => ready.promise
  })
  render(
    <DrivePanel
      controller={controller}
      controls={driveControls}
      mode="settings"
      locale="en"
      onOpenProject={async () => {}}
      confirm={() => Promise.resolve(false)}
    />
  )
  expect(screen.getByRole("status")).toHaveTextContent("Connecting to YUP Drive")
  expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument()
  await act(async () => {
    await expect(controller.attach()).rejects.toThrow("Drive subscription unavailable")
  })
  expect(screen.getByRole("alert")).toHaveTextContent("Drive subscription unavailable")
  fail = false
  await act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))

    return Promise.resolve()
  })
  expect(screen.getByRole("status")).toHaveTextContent("Connecting to YUP Drive")
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument()
  await act(async () => {
    ready.resolve({ type: "snapshot", data: snapshot })
    await controller.attach()
  })
  expect(screen.queryByRole("status")).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeInTheDocument()
  controller.dispose()
})
