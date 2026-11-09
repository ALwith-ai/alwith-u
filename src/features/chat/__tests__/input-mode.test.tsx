import { createSession } from "@alwith/module-chat/client"
import { drafts } from "@alwith/module-chat/conversation"
import { DEFAULT_IMAGE_SELECTION, type ImageSelection } from "@alwith/module-chat/image"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"

import { useImagePreferences } from "@/features/images/preferences"
import { client } from "@/lib/client"
import { initI18n } from "@/lib/i18n"

import { ChatHeader } from "../chat-header"
import { ChatComposer } from "../composer"
import { MainInputModeProvider, MainInputModeSwitch, useInputMode } from "../composer/input-mode"
import { ChatTimelineHost } from "./timeline-host"

const availability = vi.hoisted(() => ({
  available: true,
  chatgptConnected: true,
  seedreamConfigured: true,
  canGenerate: true,
  checking: false,
  error: null,
  retry: vi.fn()
}))
const savedModes = vi.hoisted(() => ({
  values: new Map<string, "chat" | "image">(),
  images: new Map<string, ImageSelection>(),
  readImage: vi.fn<(id: string) => Promise<ImageSelection | undefined>>(),
  saveImage: vi.fn<(id: string, selection: ImageSelection) => Promise<void>>(),
  read: vi.fn<(id: string) => Promise<"chat" | "image">>(),
  save: vi.fn<(id: string, mode: "chat" | "image", selection: ImageSelection) => Promise<void>>()
}))
vi.mock("../composer/input-mode-preferences", () => ({
  readSessionInputMode: savedModes.read,
  saveSessionInputMode: savedModes.save,
  readSessionImageSelection: savedModes.readImage,
  saveSessionImageSelection: savedModes.saveImage
}))
vi.mock("@/features/images/availability", () => ({ useImageAvailability: () => availability }))
vi.mock("@/features/images/preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/images/preferences")>()
  return {
    ...actual,
    useImagePreferenceSync: () => {},
    saveImageSelection: (selection: Parameters<typeof actual.saveImageSelection>[0]) => {
      actual.useImagePreferences.setState({ selection })
      return Promise.resolve()
    }
  }
})
beforeEach(() => {
  savedModes.values.clear()
  savedModes.images.clear()
  savedModes.readImage.mockReset().mockImplementation((id) => Promise.resolve(savedModes.images.get(id)))
  savedModes.saveImage.mockReset().mockImplementation((id, selection) => {
    savedModes.images.set(id, selection)
    return Promise.resolve()
  })
  savedModes.read.mockReset().mockImplementation((id) => Promise.resolve(savedModes.values.get(id) ?? "chat"))
  savedModes.save.mockReset().mockImplementation((id, mode, selection) => {
    savedModes.images.set(id, selection)
    savedModes.values.set(id, mode)
    return Promise.resolve()
  })
  availability.available = true
  availability.canGenerate = true
  availability.chatgptConnected = true
  availability.seedreamConfigured = true
  useImagePreferences.setState({ selection: DEFAULT_IMAGE_SELECTION })
})

function ModeStatus() {
  const inputMode = useInputMode()!
  return (
    <>
      <output aria-label="Restored input mode">{inputMode.ready ? inputMode.mode : "loading"}</output>
      <output aria-label="Image selection">{JSON.stringify(inputMode.selection)}</output>
      <button onClick={() => inputMode.setSelection({ model: "doubao-seedream-5-0-pro-260628", size: "2K" })}>
        Select image model
      </button>
      <button onClick={() => void inputMode.saveForSession("image-session")}>Remember mode</button>
    </>
  )
}

test("draft mode binds to its real session and reopening restores it independently", async () => {
  const draft = render(
    <MainInputModeProvider>
      <MainInputModeSwitch />
      <ModeStatus />
    </MainInputModeProvider>
  )
  fireEvent.click(draft.getByRole("button", { name: "Images" }))
  fireEvent.click(draft.getByRole("button", { name: "Remember mode" }))
  await waitFor(() => expect(savedModes.save).toHaveBeenCalledWith("image-session", "image", DEFAULT_IMAGE_SELECTION))
  draft.unmount()
  const history = render(
    <MainInputModeProvider sessionId="image-session" draft={false}>
      <ModeStatus />
    </MainInputModeProvider>
  )
  await waitFor(() => expect(history.getByLabelText("Restored input mode")).toHaveTextContent("image"))
  history.rerender(
    <MainInputModeProvider sessionId="ordinary-session" draft={false}>
      <ModeStatus />
    </MainInputModeProvider>
  )
  await waitFor(() => expect(history.getByLabelText("Restored input mode")).toHaveTextContent("chat"))
})

test("image model and resolution restore per session while new drafts inherit the recent choice", async () => {
  const selected: ImageSelection = { model: "doubao-seedream-5-0-pro-260628", size: "2K" }
  const draft = render(
    <MainInputModeProvider>
      <ModeStatus />
    </MainInputModeProvider>
  )
  fireEvent.click(draft.getByRole("button", { name: "Select image model" }))
  fireEvent.click(draft.getByRole("button", { name: "Remember mode" }))
  await waitFor(() => expect(savedModes.images.get("image-session")).toEqual(selected))
  draft.unmount()
  useImagePreferences.setState({ selection: DEFAULT_IMAGE_SELECTION })
  const history = render(
    <MainInputModeProvider sessionId="image-session" draft={false}>
      <ModeStatus />
    </MainInputModeProvider>
  )
  await waitFor(() => expect(history.getByLabelText("Image selection")).toHaveTextContent(JSON.stringify(selected)))
  expect(useImagePreferences.getState().selection).toEqual(DEFAULT_IMAGE_SELECTION)
  fireEvent.click(history.getByRole("button", { name: "Select image model" }))
  await waitFor(() => expect(savedModes.saveImage).toHaveBeenCalledWith("image-session", selected))
  history.unmount()
  const next = render(
    <MainInputModeProvider>
      <ModeStatus />
    </MainInputModeProvider>
  )
  expect(next.getByLabelText("Image selection")).toHaveTextContent(JSON.stringify(selected))
})

test("a late focus read cannot overwrite a newly selected session image model", async () => {
  savedModes.values.set("image-session", "image")
  const history = render(
    <MainInputModeProvider sessionId="image-session" draft={false}>
      <ModeStatus />
    </MainInputModeProvider>
  )
  await waitFor(() => expect(history.getByLabelText("Restored input mode")).toHaveTextContent("image"))
  const pending = Promise.withResolvers<ImageSelection | undefined>()
  savedModes.readImage.mockReturnValueOnce(pending.promise)
  fireEvent(window, new Event("focus"))
  fireEvent.click(history.getByRole("button", { name: "Select image model" }))
  await act(() => Promise.resolve(pending.resolve(DEFAULT_IMAGE_SELECTION)))
  expect(history.getByLabelText("Image selection")).toHaveTextContent("2K")
})

test("a late read cannot replace the mode of a different selected session", async () => {
  const pending = Promise.withResolvers<"chat" | "image">()
  savedModes.read.mockReturnValueOnce(pending.promise)
  savedModes.values.set("image-session", "image")
  const history = render(
    <MainInputModeProvider sessionId="ordinary-session" draft={false}>
      <ModeStatus />
    </MainInputModeProvider>
  )
  history.rerender(
    <MainInputModeProvider sessionId="image-session" draft={false}>
      <ModeStatus />
    </MainInputModeProvider>
  )
  await waitFor(() => expect(history.getByLabelText("Restored input mode")).toHaveTextContent("image"))
  await act(() => Promise.resolve(pending.resolve("chat")))
  expect(history.getByLabelText("Restored input mode")).toHaveTextContent("image")
})

await initI18n("en")
const original = client.state
const referenceData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII="
type Submit = NonNullable<ComponentProps<typeof ChatComposer>["onSubmit"]>
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  client.store.setState(original, true)
  drafts.clear()
})

function setup({
  submit,
  reference = false
}: { submit?: ComponentProps<typeof ChatComposer>["onSubmit"]; reference?: boolean } = {}) {
  const session = { ...createSession("ordinary-chat", "/tmp"), attached: true }
  const attachment = {
    id: "reference",
    type: "file" as const,
    mediaType: "image/png",
    url: `data:image/png;base64,${referenceData}`,
    filename: "reference.png"
  }
  drafts.set(session.id, {
    text: "A paper bird",
    mentions: [],
    attachments: reference ? [attachment] : [],
    modelId: null
  })
  client.store.setState({ connection: "ready", sessions: { [session.id]: session } })
  const view = render(
    <ChatTimelineHost>
      <MainInputModeProvider>
        <ChatHeader title="Ordinary chat">{null}</ChatHeader>
        <MainInputModeSwitch />
        <ChatComposer session={session} onSubmit={submit} />
      </MainInputModeProvider>
    </ChatTimelineHost>
  )
  return { ...view, session, attachment }
}

test("main-window mode changes preserve the same input, reference images and conversation", () => {
  const view = setup({ reference: true })
  const input = view.getByRole("textbox", { name: "Send a message" })
  expect(view.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true")
  const toggle = view.getByRole("group", { name: "Input mode" })
  expect(toggle.closest("header")).toBeNull()
  expect(toggle.parentElement?.previousElementSibling).toHaveAttribute("data-main-chat-header")
  fireEvent.click(view.getByRole("button", { name: "Images" }))
  expect(view.getByRole("textbox", { name: "Send a message" })).toBe(input)
  expect(input).toHaveValue("A paper bird")
  expect(input).toHaveAttribute("placeholder", "Describe an image, or add reference images to edit")
  expect(view.getByRole("button", { name: "Aspect ratio" })).toHaveTextContent("Auto")
  expect(view.getByRole("button", { name: "Image model" })).toHaveTextContent("ChatGPT Images")
  expect(view.queryByRole("button", { name: "Commands" })).not.toBeInTheDocument()
  expect(view.queryByRole("button", { name: "Voice input" })).not.toBeInTheDocument()
  expect(drafts.get(view.session.id)?.attachments).toEqual([view.attachment])
  fireEvent.click(view.getByRole("button", { name: "Chat" }))
  expect(input).toHaveValue("A paper bird")
  expect(view.getByRole("textbox", { name: "Send a message" })).toBe(input)
  expect(drafts.get(view.session.id)?.attachments).toEqual([view.attachment])
  expect(Object.keys(client.state.sessions)).toEqual([view.session.id])
})

test("missing image services keep input editable and do not send to a language model", async () => {
  availability.available = false
  availability.canGenerate = false
  availability.chatgptConnected = false
  availability.seedreamConfigured = false
  const submit = vi.fn<Submit>().mockResolvedValue(undefined)
  const prompt = vi.spyOn(client, "prompt")
  const view = setup({ submit, reference: true })
  fireEvent.keyDown(view.getByRole("button", { name: "Chat" }), { key: "ArrowRight" })
  expect(view.getByRole("button", { name: "Images" })).toHaveFocus()
  expect(view.getByRole("button", { name: "Images" })).toHaveAttribute("aria-pressed", "true")
  const input = view.getByRole("textbox", { name: "Send a message" })
  expect(input).not.toBeDisabled()
  expect(view.getByRole("button", { name: "Send" })).toBeDisabled()
  fireEvent.change(input, { target: { value: "Edit the paper bird" } })
  fireEvent.click(view.getByRole("button", { name: "Aspect ratio" }))
  fireEvent.click(await view.findByRole("menuitemradio", { name: "16:9" }))
  fireEvent.keyDown(document.activeElement!, { key: "Escape" })
  await waitFor(() => expect(view.queryByRole("menu")).not.toBeInTheDocument())
  fireEvent.keyDown(input, { key: "Enter" })
  fireEvent.submit(input.closest("form")!)
  expect(submit).not.toHaveBeenCalled()
  expect(prompt).not.toHaveBeenCalled()
  expect(input).toHaveValue("Edit the paper bird")
  expect(drafts.get(view.session.id)?.attachments).toEqual([view.attachment])
  fireEvent.keyDown(view.getByRole("button", { name: "Images" }), { key: "Home" })
  expect(view.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true")
  expect(view.getByRole("button", { name: "Send" })).not.toBeDisabled()
  fireEvent.click(view.getByRole("button", { name: "Images" }))
  expect(view.getByRole("button", { name: "Aspect ratio" })).toHaveTextContent("16:9")
})

test("composers outside the main-window provider retain the ordinary chat interface", () => {
  const session = { ...createSession("floating", "/tmp"), attached: true }
  const view = render(
    <ChatTimelineHost>
      <ChatComposer session={session} />
    </ChatTimelineHost>
  )
  expect(view.queryByRole("group", { name: "Input mode" })).not.toBeInTheDocument()
  expect(view.queryByRole("button", { name: "Aspect ratio" })).not.toBeInTheDocument()
})

test("image models and resolution are independent of the conversation's language model", async () => {
  const setConfig = vi.spyOn(client, "setConfig")
  const view = setup()
  fireEvent.click(view.getByRole("button", { name: "Images" }))
  fireEvent.click(view.getByRole("button", { name: "Image model" }))
  fireEvent.click(await view.findByRole("menuitemradio", { name: "Seedream 5.0 Pro" }))
  expect(view.getByRole("button", { name: "Image model" })).toHaveTextContent("Seedream 5.0 Pro · 1K")
  await waitFor(() => expect(view.queryByRole("menu")).not.toBeInTheDocument())
  fireEvent.click(view.getByRole("button", { name: "Image model" }))
  expect(await view.findByRole("menuitem", { name: "Resolution" })).toBeInTheDocument()
  fireEvent.keyDown(document.activeElement!, { key: "Escape" })
  await waitFor(() => expect(view.queryByRole("menu")).not.toBeInTheDocument())
  fireEvent.click(view.getByRole("button", { name: "Chat" }))
  expect(view.queryByRole("button", { name: "Image model" })).not.toBeInTheDocument()
  fireEvent.click(view.getByRole("button", { name: "Images" }))
  expect(view.getByRole("button", { name: "Image model" })).toHaveTextContent("Seedream 5.0 Pro · 1K")
  expect(setConfig).not.toHaveBeenCalled()
})

test("image input sends references and frozen model settings through the ordinary draft admission", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close: vi.fn() }))
  const submit = vi.fn<Submit>().mockResolvedValue(undefined)
  const view = setup({ submit, reference: true })
  fireEvent.click(view.getByRole("button", { name: "Images" }))
  fireEvent.click(view.getByRole("button", { name: "Aspect ratio" }))
  fireEvent.click(await view.findByRole("menuitemradio", { name: "16:9" }))
  fireEvent.keyDown(document.activeElement!, { key: "Escape" })
  await waitFor(() => expect(view.queryByRole("menu")).not.toBeInTheDocument())
  fireEvent.submit(view.getByRole("textbox", { name: "Send a message" }).closest("form")!)
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  expect(submit.mock.calls[0][0]).toEqual([
    { type: "text", text: "A paper bird" },
    { type: "image", data: referenceData, mimeType: "image/png" }
  ])
  expect(submit.mock.calls[0][2]).toEqual({
    meta: { alwith: { imageIntent: "generate", imageSelection: DEFAULT_IMAGE_SELECTION, imageAspectRatio: "16:9" } }
  })
})

test("image input on an existing ordinary conversation routes the selected model to that exact session", async () => {
  const prompt = vi.spyOn(client, "prompt").mockResolvedValue("receipt")
  const view = setup()
  fireEvent.click(view.getByRole("button", { name: "Images" }))
  fireEvent.submit(view.getByRole("textbox", { name: "Send a message" }).closest("form")!)
  await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
  expect(prompt.mock.calls[0]).toEqual([
    view.session.id,
    [{ type: "text", text: "A paper bird" }],
    { meta: { alwith: { imageIntent: "generate", imageSelection: DEFAULT_IMAGE_SELECTION, imageAspectRatio: "auto" } } }
  ])
})
