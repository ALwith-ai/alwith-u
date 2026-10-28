import type * as acp from "@agentclientprotocol/sdk/experimental/v2/unstable"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"

import { initI18n } from "@/lib/i18n"

import { ImageEditOverlay, ImageEditToolbar, useImageEditor } from "../image-editor"

await initI18n("en")

function Editor({ send, close }: { send: (prompt: acp.ContentBlock[]) => Promise<void>; close: () => void }) {
  const editor = useImageEditor("data:image/png;base64,b3JpZw==", { width: 600, height: 400 }, send, close)
  return (
    <>
      <ImageEditOverlay editor={editor} />
      <ImageEditToolbar editor={editor} />
    </>
  )
}

test("background removal sends immediately to the supplied destination without touching a composer draft", async () => {
  const send = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn()
  const view = render(<Editor send={send} close={close} />)
  fireEvent.click(view.getByRole("button", { name: "Remove background" }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(send).toHaveBeenCalledWith([
    { type: "image", mimeType: "image/png", data: "b3JpZw==" },
    { type: "text", text: expect.stringContaining("transparent") }
  ])
})

test("resize lists the five aspect ratios and choosing one sends immediately", async () => {
  const send = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn()
  const view = render(<Editor send={send} close={close} />)
  fireEvent.click(view.getByRole("button", { name: "Resize" }))
  expect(view.queryByRole("spinbutton")).toBeNull()
  for (const ratio of ["1:1", "3:4", "9:16", "4:3", "16:9"])
    expect(view.getByRole("menuitem", { name: new RegExp(ratio) })).toBeDefined()
  fireEvent.click(view.getByRole("menuitem", { name: /Widescreen.*16:9/ }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(send.mock.calls[0][0]).toMatchObject([
    { type: "image", data: "b3JpZw==" },
    { type: "text", text: expect.stringContaining("16:9") }
  ])
})

test("direct-action failures stay visible and can retry without a confirmation form", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined)
  const close = vi.fn()
  const view = render(<Editor send={send} close={close} />)
  fireEvent.click(view.getByRole("button", { name: "Remove background" }))
  expect(await view.findByRole("alert")).toHaveTextContent("Offline")
  expect(close).not.toHaveBeenCalled()
  expect(view.queryByRole("textbox")).toBeNull()
  fireEvent.click(view.getByRole("button", { name: "Remove background" }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
})

test("annotation replaces the action toolbar with drawing tools and a separate instruction input", () => {
  const view = render(<Editor send={vi.fn()} close={vi.fn()} />)
  fireEvent.click(view.getByRole("button", { name: "Annotate" }))
  expect(view.queryByRole("button", { name: "Remove background" })).toBeNull()
  expect(view.getByRole("textbox", { name: "Edit instructions" })).toBeDefined()
  expect(view.getByRole("button", { name: "Send" })).toBeDisabled()
  for (const name of ["Brush", "Rectangle", "Arrow", "Undo", "Redo"])
    expect(view.getByRole("button", { name })).toBeDefined()
  fireEvent.click(view.getByRole("button", { name: "Cancel editing" }))
  fireEvent.click(view.getByRole("button", { name: "Erase" }))
  expect(view.queryByRole("textbox")).toBeNull()
  expect(view.getByRole("button", { name: "Send" })).toBeDisabled()
  expect(view.getByRole("slider", { name: "Brush size" })).toBeDefined()
  expect(view.getByText("Paint over the area to remove")).toBeDefined()
})

test("drawing follows displayed coordinates, undo removes only the last stroke, and masks stay separate", () => {
  const view = render(<Editor send={vi.fn()} close={vi.fn()} />)
  fireEvent.click(view.getByRole("button", { name: "Annotate" }))
  fireEvent.click(view.getByRole("button", { name: "Rectangle" }))
  const selection = view.getByRole("img", { name: "Image selection" })
  vi.spyOn(selection, "getBoundingClientRect").mockReturnValue({
    left: 100,
    top: 50,
    width: 300,
    height: 200
  } as DOMRect)
  // jsdom does not implement native pointer capture.
  Object.assign(selection, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn()
  })
  const draw = (): void => {
    fireEvent.pointerDown(selection, { pointerId: 1, button: 0, clientX: 130, clientY: 70 })
    fireEvent.pointerMove(selection, { pointerId: 1, clientX: 250, clientY: 150 })
    fireEvent.pointerUp(selection, { pointerId: 1, clientX: 250, clientY: 150 })
  }
  draw()
  expect(selection.querySelector("path")?.getAttribute("d")).toBe("M60 40H300V200H60Z")
  draw()
  expect(selection.querySelectorAll("path")).toHaveLength(2)
  fireEvent.click(view.getByRole("button", { name: "Undo" }))
  expect(selection.querySelectorAll("path")).toHaveLength(1)
  fireEvent.click(view.getByRole("button", { name: "Redo" }))
  expect(selection.querySelectorAll("path")).toHaveLength(2)
  fireEvent.click(view.getByRole("button", { name: "Undo" }))
  draw()
  expect(view.getByRole("button", { name: "Redo" })).toBeDisabled()
  fireEvent.click(view.getByRole("button", { name: "Undo" }))
  fireEvent.click(view.getByRole("button", { name: "Cancel editing" }))
  fireEvent.click(view.getByRole("button", { name: "Erase" }))
  expect(view.getByRole("img").querySelectorAll("path")).toHaveLength(0)
  fireEvent.click(view.getByRole("button", { name: "Cancel editing" }))
  fireEvent.click(view.getByRole("button", { name: "Annotate" }))
  expect(view.getByRole("img").querySelectorAll("path")).toHaveLength(1)
})

test("the color picker changes new marks without recoloring previous strokes, including undo and redo", () => {
  const view = render(<Editor send={vi.fn()} close={vi.fn()} />)
  fireEvent.click(view.getByRole("button", { name: "Annotate" }))
  const selection = view.getByRole("img", { name: "Image selection" })
  vi.spyOn(selection, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 300, height: 200 } as DOMRect)
  Object.assign(selection, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn()
  })
  const draw = (): void => {
    fireEvent.pointerDown(selection, { pointerId: 1, button: 0, clientX: 20, clientY: 20 })
    fireEvent.pointerUp(selection, { pointerId: 1, clientX: 100, clientY: 100 })
  }
  draw()
  const originalColor = selection.querySelector("path")?.getAttribute("stroke")
  expect(originalColor).toBeTruthy()
  fireEvent.click(view.getByRole("button", { name: "Annotation color" }))
  fireEvent.keyDown(view.getByRole("radio", { name: "Red" }), { key: "ArrowDown" })
  expect(view.getByRole("radio", { name: "Blue" })).toHaveAttribute("aria-checked", "true")
  expect(view.getByRole("radio", { name: "Blue" })).toHaveFocus()
  fireEvent.click(view.getByRole("radio", { name: "Blue" }))
  fireEvent.click(view.getByRole("button", { name: "Rectangle" }))
  draw()
  const colors = [...selection.querySelectorAll("path")].map((path) => path.getAttribute("stroke"))
  expect(colors[0]).toBe(originalColor)
  expect(colors[1]).not.toBe(originalColor)
  expect(colors[1]).toBe("#2563eb")
  fireEvent.click(view.getByRole("button", { name: "Undo" }))
  fireEvent.click(view.getByRole("button", { name: "Redo" }))
  expect([...selection.querySelectorAll("path")].map((path) => path.getAttribute("stroke"))).toEqual(colors)
})
