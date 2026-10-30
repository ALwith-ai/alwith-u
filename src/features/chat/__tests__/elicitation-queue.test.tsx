import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import { useStore } from "zustand"

import { createFakeAgent } from "@/agent/__tests__/fake-agent"
import { FakeHubPort } from "@/agent/__tests__/fake-runtime-client"
import { type AppState, CodexClient } from "@/agent/client"
import { ThemeProvider } from "@/components/theme-provider"
import { initI18n } from "@/lib/i18n"

const owner = vi.hoisted(() => ({ current: null as CodexClient | null }))
vi.mock("@/lib/client", () => ({
  get client() {
    if (owner.current === null) throw new Error("Test client is unavailable")
    return owner.current
  },
  useApp: <T,>(selector: (state: AppState) => T) => {
    if (owner.current === null) throw new Error("Test client is unavailable")
    return useStore(owner.current.store, selector)
  }
}))
vi.mock("../chat-actions-menu", () => ({ ChatActionsMenu: () => null }))
vi.mock("../composer", () => ({ ChatComposer: () => null }))
vi.mock("../dialogs/chat-search", () => ({ ChatSearch: () => null }))
vi.mock("../dialogs/image-lightbox", () => ({
  ImageLightbox: () => null,
  openImageLightbox: vi.fn(),
  openImageGallery: vi.fn()
}))
const { ChatView } = await import("../chat-view")
await initI18n("en")

test("queued forms advance on accept, decline and cancel without answering another session", async () => {
  const fake = createFakeAgent()
  const client = new CodexClient(() => Promise.try(() => new FakeHubPort(() => fake.app)), {
    agentId: "codex",
    launch: { engine: "codex" }
  })
  owner.current = client
  await client.connect()
  const first = await client.newSession("/qa/first")
  const other = await client.newSession("/qa/other")
  const request = (sessionId: string, title: string) =>
    fake.requestForm({
      sessionId,
      mode: "form",
      message: title,
      requestedSchema: {
        type: "object",
        title,
        properties: {
          choice: {
            type: "string",
            title: "Scope",
            description: "Which implementation should be used?",
            oneOf: [
              { const: "Alpha", title: "Alpha", description: "Use the source application" },
              { const: "Beta", title: "Beta", description: "Include installed extensions" }
            ],
            _meta: { codex: { isOther: true, isSecret: false } }
          },
          choice__other: {
            type: "string",
            title: "Other (Scope)",
            _meta: { codex: { questionId: "choice", isOtherAnswer: true, isSecret: false } }
          }
        },
        required: []
      }
    })
  const replies = [request(first, "Question one"), request(first, "Question two"), request(first, "Question three")]
  const otherReply = request(other, "Other session question")
  await vi.waitFor(() => expect(client.state.actions).toHaveLength(4))
  const view = render(
    <ThemeProvider>
      <ChatView session={client.session(first)} onNewChat={() => {}} onDeleted={() => {}} />
    </ThemeProvider>
  )
  try {
    expect(view.getAllByRole("dialog")).toHaveLength(1)
    expect(view.getByText("Which implementation should be used?")).toBeVisible()
    expect(view.getByText("Include installed extensions")).toBeVisible()
    expect(view.getByText("1 / 3")).toBeInTheDocument()
    fireEvent.click(view.getByRole("radio", { name: /^Beta/ }))
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Submit" }))))
    expect(await replies[0]).toMatchObject({ action: "accept", content: { choice: "Beta" } })
    await waitFor(() => expect(view.getByRole("heading", { name: "Question two" })).toBeInTheDocument())
    expect(view.getByRole("radio", { name: /^Alpha/ })).toBeChecked()
    expect(view.getByText("1 / 2")).toBeInTheDocument()
    await act(() => Promise.try(() => fireEvent.click(view.getByRole("button", { name: "Decline" }))))
    expect(await replies[1]).toMatchObject({ action: "decline" })
    await waitFor(() => expect(view.getByRole("heading", { name: "Question three" })).toBeInTheDocument())
    await act(() => Promise.try(() => fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" })))
    expect(await replies[2]).toMatchObject({ action: "cancel" })
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull())
    expect(client.state.actions).toHaveLength(1)
    expect(client.state.actions[0].sessionId).toBe(other)
    client.respond(client.state.actions[0].id, { action: "cancel" })
    expect(await otherReply).toMatchObject({ action: "cancel" })
  } finally {
    view.unmount()
    client.disconnect()
    owner.current = null
  }
})
