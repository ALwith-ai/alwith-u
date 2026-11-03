import { createSession } from "@alwith/module-chat/client"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { ImagePage } from "../image-page"

const service = vi.hoisted(() => ({
  modelMenu: vi.fn(),
  connect: vi.fn(),
  newImageSession: vi.fn(),
  discardDraft: vi.fn(),
  promptWithImages: vi.fn(),
  open: vi.fn(),
  state: {
    connection: "ready",
    sessions: {} as Record<string, import("@alwith/module-chat/client").Session>,
    drafts: {} as Record<string, boolean>
  }
}))
vi.mock("@/lib/client", () => ({
  client: service,
  useSession: (id: string | null) => (id ? (service.state.sessions[id] ?? null) : null)
}))
vi.mock("@/features/chat/chat-host", () => ({
  ChatHostProvider: ({ children }: { children: import("react").ReactNode }) => <>{children}</>
}))
vi.mock("@alwith/module-chat/conversation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ModelMenu: service.modelMenu
}))
vi.mock("../model-select", () => ({ ImageModelSelect: () => <span>Image models</span> }))
vi.mock("../availability", () => ({
  useImageAvailability: () => ({ available: true, canGenerate: true, checking: false, error: null })
}))
vi.mock("../image-gallery", () => ({
  ImageGallery: (props: import("react").ComponentProps<typeof import("../image-gallery").ImageGallery>) => (
    <>
      {props.intro}
      <button
        onClick={() =>
          props.onPreview(
            {
              sessionId: "original",
              cwd: "/source",
              title: "Source",
              updatedAt: null,
              archived: false,
              threadSource: "alwith-images"
            },
            [
              {
                id: "result:0",
                turnId: "source-turn",
                src: "data:image/png;base64,b3JpZw==",
                data: "b3JpZw==",
                mimeType: "image/png",
                toolId: "result",
                prompt: "Original image"
              }
            ],
            0
          )
        }
      >
        Preview original
      </button>
      {props.footer}
    </>
  )
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ratio?: string }) => (options?.ratio ? `${key}: ${options.ratio}` : key)
  })
}))

beforeEach(() => {
  vi.clearAllMocks()
  service.connect.mockResolvedValue(undefined)
  service.modelMenu.mockReturnValue(<span>Conversation model and effort</span>)
  service.state.sessions = {
    "new-images": { ...createSession("new-images", "/tmp"), attached: true },
    "edited-images": { ...createSession("edited-images", "/source"), attached: true },
    original: { ...createSession("original", "/source"), attached: true }
  }
  service.state.drafts = { "new-images": true, "edited-images": true }
  service.newImageSession.mockResolvedValue("new-images")
  service.discardDraft.mockResolvedValue(undefined)
  service.promptWithImages.mockResolvedValue("receipt")
  service.open.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())
async function setup(contextSession?: import("@alwith/module-chat/client").Session) {
  const onCreated = vi.fn()
  const onOpenConversation = vi.fn()
  const view = render(
    <ImagePage
      cwd="/tmp"
      contextSession={contextSession}
      busy={false}
      onCreated={onCreated}
      onOpenConversation={onOpenConversation}
    />
  )
  await act(async () => {
    await waitFor(() => expect(service.newImageSession).toHaveBeenCalled())
  })
  return { onCreated, onOpenConversation, ...view }
}

test("discovery and templates offer image settings without the ordinary conversation model catalog", async () => {
  service.state.sessions["new-images"].configOptions = [
    {
      configId: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-6.1-sol",
      options: [
        { value: "gpt-6.1-sol", name: "6.1 Sol" },
        { value: "gpt-6-astra", name: "6 Astra" },
        { value: "gpt-6-luna", name: "6 Luna" }
      ]
    }
  ]
  await setup()
  expect(screen.getAllByText("Image models")).toHaveLength(1)
  expect(service.modelMenu).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: /images.templates.illustration.title/ }))
  expect(screen.getAllByText("Image models")).toHaveLength(1)
  expect(service.modelMenu).not.toHaveBeenCalled()
  expect(screen.queryByText("Conversation model and effort")).not.toBeInTheDocument()
})

test("discovery enters the main conversation only after prompt acceptance", async () => {
  const pending = Promise.withResolvers<string>()
  service.promptWithImages.mockReturnValueOnce(pending.promise)
  const { onCreated } = await setup()
  expect(screen.getByText("images.discover")).toBeInTheDocument()
  fireEvent.change(screen.getByPlaceholderText("images.prompt"), { target: { value: "A blue circle" } })
  fireEvent.click(screen.getByRole("button", { name: "images.generate" }))
  await waitFor(() => expect(service.promptWithImages).toHaveBeenCalled())
  expect(onCreated).not.toHaveBeenCalled()
  expect(service.newImageSession).toHaveBeenCalledExactlyOnceWith("/tmp", { draft: true })
  expect(service.promptWithImages).toHaveBeenCalledWith("new-images", [{ type: "text", text: "A blue circle" }], {
    meta: { alwith: { imageAspectRatio: "auto" } }
  })
  await act(async () => pending.resolve("receipt"))
  await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith("new-images"))
})

test("a failed request keeps the prompt and retries the same image conversation", async () => {
  service.promptWithImages.mockRejectedValueOnce(new Error("Image service unavailable"))
  const { onCreated } = await setup()
  fireEvent.change(screen.getByPlaceholderText("images.prompt"), { target: { value: "A blue circle" } })
  fireEvent.click(screen.getByRole("button", { name: "images.generate" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Image service unavailable")
  expect(screen.getByPlaceholderText("images.prompt")).toHaveValue("A blue circle")
  expect(onCreated).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "images.generate" }))
  await waitFor(() => expect(onCreated).toHaveBeenCalled())
  expect(service.newImageSession).toHaveBeenCalledTimes(1)
})

test("trying a template uses its description and the main composer aspect through ACP", async () => {
  const { onCreated } = await setup()
  fireEvent.click(screen.getByRole("button", { name: "images.aspectRatio" }))
  fireEvent.click(screen.getByRole("menuitemradio", { name: "4:3" }))
  fireEvent.click(screen.getByRole("button", { name: /images.templates.illustration.title/ }))
  fireEvent.click(screen.getByRole("button", { name: "images.tryTemplate" }))
  await waitFor(() => expect(onCreated).toHaveBeenCalled())
  expect(service.promptWithImages).toHaveBeenCalledWith(
    "new-images",
    [{ type: "text", text: "images.templates.illustration.prompt\n\nimages.aspectInstruction: 4:3" }],
    { meta: { alwith: { imageAspectRatio: "4:3" } } }
  )
})

test("a portrait template requires an explicitly selected reference before submission", async () => {
  await setup()
  fireEvent.click(screen.getByRole("button", { name: /images.templates.portrait.title/ }))
  fireEvent.click(screen.getByRole("button", { name: "images.tryTemplate" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("images.referenceRequired")
  expect(service.newImageSession).toHaveBeenCalledExactlyOnceWith("/tmp", { draft: true })
  expect(service.promptWithImages).not.toHaveBeenCalled()
})

test("previous uploads are not offered or carried into a template request", async () => {
  await setup({
    ...createSession("context", "/tmp"),
    items: [
      {
        kind: "user",
        id: "upload",
        at: 1,
        replayed: true,
        _meta: null,
        echo: null,
        content: [
          { type: "image", mimeType: "image/png", data: "Zmlyc3Q=" },
          { type: "image", mimeType: "image/png", data: "c2Vjb25k" }
        ]
      }
    ]
  })
  expect(screen.queryByRole("button", { name: "images.recentUploads" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /images.templates.portrait.title/ }))
  expect(screen.queryByRole("button", { name: "images.recentUploads" })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "images.tryTemplate" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("images.referenceRequired")
  expect(service.promptWithImages).not.toHaveBeenCalled()
})

test("leaving discovery releases its unsent native draft", async () => {
  const { unmount } = await setup()
  unmount()
  await waitFor(() => expect(service.discardDraft).toHaveBeenCalledWith("new-images"))
  expect(service.discardDraft).not.toHaveBeenCalledWith("main")
})

test("leaving during admission cannot navigate back after a late receipt", async () => {
  const pending = Promise.withResolvers<string>()
  service.promptWithImages.mockReturnValueOnce(pending.promise)
  const { onCreated, unmount } = await setup()
  fireEvent.change(screen.getByPlaceholderText("images.prompt"), { target: { value: "A blue circle" } })
  fireEvent.click(screen.getByRole("button", { name: "images.generate" }))
  await waitFor(() => expect(service.promptWithImages).toHaveBeenCalled())
  unmount()
  expect(service.discardDraft).not.toHaveBeenCalled()
  delete service.state.drafts["new-images"]
  await act(async () => pending.resolve("receipt"))
  expect(onCreated).not.toHaveBeenCalled()
  expect(service.open).not.toHaveBeenCalled()
  expect(service.discardDraft).not.toHaveBeenCalled()
})

test("gallery quick edits continue the image's owning conversation", async () => {
  const { onCreated, onOpenConversation } = await setup()
  fireEvent.click(screen.getByRole("button", { name: "Preview original" }))
  expect(screen.getByRole("img", { name: "Original image" })).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "chat.image.edit.background" }))
  await waitFor(() =>
    expect(onOpenConversation).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "original" }))
  )
  expect(service.newImageSession).toHaveBeenCalledExactlyOnceWith("/tmp", { draft: true })
  expect(service.open).toHaveBeenCalledWith("original", "/source")
  expect(service.promptWithImages.mock.calls[0][0]).toBe("original")
  expect(service.promptWithImages.mock.calls[0][1]).toContainEqual({
    type: "image",
    mimeType: "image/png",
    data: "b3JpZw=="
  })
  expect(onCreated).not.toHaveBeenCalled()
})

test("opening the original conversation from preview does not generate or create a new session", async () => {
  const { onOpenConversation } = await setup()
  fireEvent.click(screen.getByRole("button", { name: "Preview original" }))
  fireEvent.click(screen.getByRole("button", { name: "images.openConversation" }))
  expect(onOpenConversation).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: "original", cwd: "/source", title: "Source" })
  )
  expect(service.newImageSession).toHaveBeenCalledExactlyOnceWith("/tmp", { draft: true })
  expect(service.promptWithImages).not.toHaveBeenCalled()
})
