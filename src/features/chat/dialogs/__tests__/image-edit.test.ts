import { expect, test } from "vitest"

import { imageEditPrompt, imagePoint } from "../image-edit"

test("erase sends the original before a separate mask and never treats the mask as a replacement", () => {
  const prompt = imageEditPrompt({
    mode: "erase",
    source: "data:image/png;base64,b3JpZw==",
    overlay: "data:image/png;base64,bWFzaw==",
    instruction: "Keep the paper texture"
  })
  expect(prompt[0]).toMatchObject({ type: "image", data: "b3JpZw==", mimeType: "image/png" })
  expect(prompt[1]).toMatchObject({ type: "image", data: "bWFzaw==", mimeType: "image/png" })
  expect(prompt[2]).toMatchObject({ type: "text", text: expect.stringMatching(/white.*black/s) })
  expect(prompt[2]).toMatchObject({ text: expect.stringContaining("Keep the paper texture") })
})

test("annotation preserves the original and includes the marked reference", () => {
  expect(
    imageEditPrompt({
      mode: "annotate",
      source: "data:image/jpeg;base64,b3JpZw==",
      overlay: "data:image/png;base64,bWFyaw==",
      instruction: "Make this blue"
    })
  ).toMatchObject([
    { type: "image", mimeType: "image/jpeg", data: "b3JpZw==" },
    { type: "image", mimeType: "image/png", data: "bWFyaw==" },
    { type: "text", text: expect.stringContaining("Make this blue") }
  ])
})

test("background removal requests transparency and resizing requests a ratio without stretching", () => {
  expect(
    imageEditPrompt({ mode: "background", source: "data:image/png;base64,b3JpZw==", instruction: "" }).at(-1)
  ).toMatchObject({ text: expect.stringContaining("transparent") })
  expect(
    imageEditPrompt({
      mode: "resize",
      source: "data:image/png;base64,b3JpZw==",
      aspectRatio: "4:3",
      instruction: ""
    }).at(-1)
  ).toMatchObject({ text: expect.stringContaining("4:3") })
})

test("invalid images, missing edit context and invalid ratios are rejected before sending", () => {
  expect(() => imageEditPrompt({ mode: "erase", source: "data:image/png;base64,b3JpZw==", instruction: "" })).toThrow()
  expect(() =>
    imageEditPrompt({ mode: "annotate", source: "https://example.com/image.png", instruction: "" })
  ).toThrow()
  expect(() =>
    imageEditPrompt({
      mode: "resize",
      source: "data:image/png;base64,b3JpZw==",
      aspectRatio: "2:7" as "1:1",
      instruction: ""
    })
  ).toThrow()
})

test("pointer coordinates are normalized against the displayed image and clamped at its edges", () => {
  const bounds = { left: 100, top: 50, width: 400, height: 200 }
  expect(imagePoint(300, 100, bounds)).toEqual({ x: 0.5, y: 0.25 })
  expect(imagePoint(600, 0, bounds)).toEqual({ x: 1, y: 0 })
})
