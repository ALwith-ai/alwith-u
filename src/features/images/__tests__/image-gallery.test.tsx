import { applyUpdate, createSession, type SessionSummary } from "@alwith/module-chat/client"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { CodexClient } from "@/agent/client"
import { IMAGE_THREAD_SOURCE } from "@/agent/session-kind"

import { ImageGallery } from "../image-gallery"

const service = vi.hoisted(() => ({ client: null as unknown as CodexClient }))
vi.mock("@/lib/client", () => ({
  get client() {
    return service.client
  }
}))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function row(sessionId: string, image = true): SessionSummary {
  return {
    sessionId,
    cwd: "/tmp",
    title: sessionId,
    archived: false,
    updatedAt: "2026-11-03",
    ...(image ? { threadSource: IMAGE_THREAD_SOURCE } : {})
  }
}
function image(id: string, tool: string, prompt: string) {
  return applyUpdate(createSession(id, "/tmp"), {
    sessionUpdate: "tool_call_update",
    toolCallId: tool,
    name: "image_generation",
    status: "completed",
    rawInput: { arguments: { prompt } },
    content: [{ type: "content", content: { type: "image", mimeType: "image/png", data: "aGVsbG8=" } }]
  })
}
function fixture(rows: SessionSummary[]) {
  const client = new CodexClient(
    async () => {
      throw new Error("No process")
    },
    { agentId: "gallery", launch: { engine: "codex" } }
  )
  client.store.setState({ connection: "ready", sessionList: rows, sessionListLoaded: true })
  service.client = client
  const history = vi.spyOn(client, "readSessionHistory")
  vi.spyOn(client, "listSessions").mockResolvedValue()
  return { client, history }
}

test("gallery restores paginated images without attaching and previews the exact image and source conversation", async () => {
  const target = row("image-session")
  const { client, history } = fixture([row("ordinary", false), target])
  history
    .mockResolvedValueOnce({ session: image(target.sessionId, "recent", "Green circle"), cursor: "older" })
    .mockResolvedValueOnce({ session: image(target.sessionId, "first", "Blue circle"), cursor: null })
  const open = vi.spyOn(client, "open")
  const selected = vi.fn()
  render(<ImageGallery onPreview={selected} busy={false} />)
  fireEvent.click(await screen.findByRole("button", { name: "Green circle" }))
  expect(selected).toHaveBeenCalledWith(target, [expect.objectContaining({ id: "recent:0" })], 0)
  expect(open).not.toHaveBeenCalled()
  expect(history).toHaveBeenCalledExactlyOnceWith(target.sessionId, "/tmp")
  fireEvent.click(screen.getByRole("button", { name: "images.olderVersions" }))
  fireEvent.click(await screen.findByRole("button", { name: "Blue circle" }))
  expect(selected).toHaveBeenLastCalledWith(
    target,
    expect.arrayContaining([expect.objectContaining({ id: "first:0" })]),
    0
  )
  expect(history).toHaveBeenLastCalledWith(target.sessionId, "/tmp", "older")
  expect(screen.queryByText("ordinary")).not.toBeInTheDocument()
})

test("failed history can be retried before any gallery images are available", async () => {
  const target = row("failed-creation")
  const { history } = fixture([target])
  history
    .mockRejectedValueOnce(new Error("Read failed"))
    .mockResolvedValueOnce({ session: image(target.sessionId, "retry", "Recovered picture"), cursor: null })
  render(<ImageGallery onPreview={vi.fn()} busy={false} />)
  await screen.findByRole("alert")
  fireEvent.click(screen.getByRole("button", { name: "images.retry" }))
  expect(await screen.findByRole("button", { name: "Recovered picture" })).toBeInTheDocument()
})

test("a list refresh during an in-flight history read does not leave the gallery stuck loading", async () => {
  const target = row("changing")
  const { client, history } = fixture([target])
  let finish!: (value: Awaited<ReturnType<typeof client.readSessionHistory>>) => void
  history
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValueOnce({ session: image(target.sessionId, "new", "Latest picture"), cursor: null })
  render(<ImageGallery onPreview={vi.fn()} busy={false} />)
  await waitFor(() => expect(history).toHaveBeenCalledOnce())
  act(() => client.store.setState({ sessionList: [{ ...target, updatedAt: "later" }] }))
  await act(async () => finish({ session: createSession(target.sessionId, "/tmp"), cursor: null }))
  expect(await screen.findByRole("button", { name: "Latest picture" })).toBeInTheDocument()
  expect(history).toHaveBeenCalledTimes(2)
})
